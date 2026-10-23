'use strict';

const assert = require('assert');
const { speedTest } = require('../../server/tools/speed-test');
const { discover } = require('../../server/tools/discover');
const { routerDetect } = require('../../server/tools/router-detect');
const { loadHost } = require('../../server/tools/host');
const { checkAsync } = require('./harness');
const { LAN, PORTS, IFCONFIG, QUALITY, PING, UPNP, lanHost } = require('./fixtures');

const VIRTUAL = ['feth1234', 'tap0', 'en9'];
const VIRTUAL_IPS = ['10.147.17.1', '10.8.0.1', '10.99.0.1'];

async function run() {
  await checkAsync('speed_test skips a down interface and will not ping a public gateway', async () => {
    const previousSkip = process.env.HNC_SKIP_NETWORK;
    process.env.HNC_SKIP_NETWORK = '1';
    try {
      let ran = false;
      const skippedNet = await speedTest({ interface: 'all' }, {
        platform: 'darwin',
        runCommand: async () => { ran = true; throw new Error('ran'); },
        loadHost: async () => { ran = true; throw new Error('ran'); }
      });
      assert.strictEqual(skippedNet.skipped_network, true);
      assert.deepStrictEqual(skippedNet.interfaces, []);
      assert.strictEqual(ran, false);
    } finally {
      if (previousSkip == null) delete process.env.HNC_SKIP_NETWORK;
      else process.env.HNC_SKIP_NETWORK = previousSkip;
    }
    const calls = [];
    const runCommand = async (file, args) => {
      calls.push(`${file} ${args.join(' ')}`);
      if (file === 'networksetup') return { stdout: PORTS, ok: true, spawnError: false };
      if (file === 'ifconfig') return { stdout: IFCONFIG, ok: true, spawnError: false };
      if (file === 'ping') return { stdout: PING, ok: true, spawnError: false };
      if (file === 'networkQuality') return { stdout: QUALITY, ok: true, spawnError: false };
      throw new Error(`unexpected ${file}`);
    };
    const skipped = await speedTest({ interface: 'ethernet' }, {
      platform: 'darwin',
      loadHost: async () => lanHost(),
      runCommand
    });
    assert.strictEqual(skipped.interfaces[0].status, 'skipped');
    assert.ok(!calls.some((call) => call.startsWith('networkQuality')));
    calls.length = 0;
    const blocked = await speedTest({ interface: 'wifi', plan_down_mbps: 300, plan_up_mbps: 40 }, {
      platform: 'darwin',
      loadHost: async () => ({
        interfaces: LAN,
        route: { gateway: '8.8.8.8', interface: 'en0', raw_gateway: '8.8.8.8' }
      }),
      runCommand
    });
    assert.ok(!calls.some((call) => call.startsWith('ping')));
    assert.strictEqual(blocked.interfaces[0].status, 'tested');
    assert.strictEqual(blocked.interfaces[0].down_mbps, 240);
    assert.strictEqual(blocked.interfaces[0].vs_plan.down_vs_plan, 'meets_plan');
    assert.strictEqual(blocked.interfaces[0].ping_gateway.skipped, true);
    const linux = await speedTest({}, {
      platform: 'linux',
      runCommand: () => { throw new Error('spawned'); }
    });
    assert.strictEqual(linux.error, 'unsupported OS');
  });

  await checkAsync('speed_test all includes Wi-Fi and pings each interface gateway', async () => {
    const calls = [];
    const ports = [
      'Hardware Port: Ethernet',
      'Device: en0',
      'Ethernet Address: aa:bb:cc:dd:ee:01',
      '',
      'Hardware Port: USB 10/100/1000 LAN',
      'Device: en5',
      'Ethernet Address: 11:22:33:44:55:01',
      '',
      'Hardware Port: USB 10/100/1000 LAN',
      'Device: en6',
      'Ethernet Address: 11:22:33:44:55:02',
      '',
      'Hardware Port: USB 10/100/1000 LAN',
      'Device: en7',
      'Ethernet Address: 11:22:33:44:55:03',
      '',
      'Hardware Port: USB 10/100/1000 LAN',
      'Device: en8',
      'Ethernet Address: 11:22:33:44:55:04',
      '',
      'Hardware Port: Wi-Fi',
      'Device: en1',
      'Ethernet Address: 68:4a:76:10:00:01'
    ].join('\n');
    const ifconfigText = [
      'en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.90.50 netmask 0xffffff00 broadcast 192.168.90.255',
      '\tstatus: active',
      'en1: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.4.20 netmask 0xffffff00 broadcast 192.168.4.255',
      '\tstatus: active',
      'en5: flags=8822<UP,BROADCAST,SMART,SIMPLEX,MULTICAST> mtu 1500',
      '\tstatus: inactive',
      'en6: flags=8822<UP,BROADCAST,SMART,SIMPLEX,MULTICAST> mtu 1500',
      '\tstatus: inactive',
      'en7: flags=8822<UP,BROADCAST,SMART,SIMPLEX,MULTICAST> mtu 1500',
      '\tstatus: inactive',
      'en8: flags=8822<UP,BROADCAST,SMART,SIMPLEX,MULTICAST> mtu 1500',
      '\tstatus: inactive'
    ].join('\n');
    const result = await speedTest({ interface: 'all' }, {
      platform: 'darwin',
      loadHost: async () => ({
        interfaces: [
          { device: 'en0', address: '192.168.90.50', netmask: '255.255.255.0' },
          { device: 'en1', address: '192.168.4.20', netmask: '255.255.255.0' }
        ],
        route: { gateway: '192.168.90.1', interface: 'en0', raw_gateway: '192.168.90.1' }
      }),
      runCommand: async (file, args) => {
        calls.push(`${file} ${args.join(' ')}`);
        if (file === 'networksetup') return { stdout: ports, ok: true, spawnError: false };
        if (file === 'ifconfig') return { stdout: ifconfigText, ok: true, spawnError: false };
        if (file === 'ping') return { stdout: PING, ok: true, spawnError: false };
        if (file === 'networkQuality') {
          const device = args[args.indexOf('-I') + 1];
          const rpm = device === 'en1' ? 126 : 840;
          return {
            stdout: JSON.stringify({
              base_rtt: 8,
              dl_throughput: device === 'en1' ? 400000000 : 900000000,
              ul_throughput: 40000000,
              responsiveness: rpm,
              interface_name: device
            }),
            ok: true,
            spawnError: false
          };
        }
        throw new Error(`unexpected ${file}`);
      }
    });
    const devices = result.interfaces.map((item) => item.device);
    assert.ok(devices.includes('en1'), devices.join(','));
    assert.ok(devices.includes('en0'), devices.join(','));
    assert.ok(devices.indexOf('en1') < devices.indexOf('en5'));
    const wifi = result.interfaces.find((item) => item.device === 'en1');
    const ethernet = result.interfaces.find((item) => item.device === 'en0');
    const down = result.interfaces.find((item) => item.device === 'en5');
    assert.strictEqual(wifi.status, 'tested');
    assert.strictEqual(wifi.ping_gateway.host, '192.168.4.1');
    assert.strictEqual(wifi.ping_gateway.skipped, false);
    assert.strictEqual(wifi.responsiveness_rpm, 126);
    assert.strictEqual(ethernet.ping_gateway.host, '192.168.90.1');
    assert.strictEqual(ethernet.responsiveness_rpm, 840);
    assert.strictEqual(down.status, 'skipped');
    assert.strictEqual(down.ping_gateway.skipped, true);
    assert.strictEqual(down.ping_gateway.loss_pct, undefined);
    const pings = calls.filter((call) => call.startsWith('ping ')).map((call) => call.split(' ').pop());
    assert.deepStrictEqual(pings, ['192.168.4.1', '192.168.90.1']);
    const measured = calls.filter((call) => call.startsWith('networkQuality ')).map((call) => call.split(' ')[2]);
    assert.deepStrictEqual(measured, ['en1', 'en0']);
  });

  await checkAsync('loadHost keeps each interface gateway and drops tunnels', async () => {
    const ifconfigText = [
      'en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.90.50 netmask 0xffffff00 broadcast 192.168.90.255',
      '\tstatus: active',
      'en1: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.4.20 netmask 0xffffff00 broadcast 192.168.4.255',
      '\tstatus: active',
      'utun3: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1380',
      '\tinet 10.0.0.2 --> 10.0.0.1 netmask 0xff000000'
    ].join('\n');
    const host = await loadHost({
      runCommand: async (file, args) => {
        if (file === 'route' && !(args || []).includes('-ifscope')) {
          return { stdout: 'gateway: 192.168.90.1\ninterface: en0\n', ok: true, spawnError: false };
        }
        if (file === 'route') return { stdout: 'gateway: 192.168.90.1\ninterface: en0\n', ok: true, spawnError: false };
        if (file === 'ifconfig') return { stdout: ifconfigText, ok: true, spawnError: false };
        if (file === 'ipconfig' && (args || []).includes('en0')) return { stdout: '192.168.90.1\n', ok: true, spawnError: false };
        if (file === 'ipconfig') return { stdout: '\n', ok: true, spawnError: false };
        throw new Error(`unexpected ${file}`);
      }
    });
    assert.deepStrictEqual(host.interfaces.map((item) => item.device), ['en0', 'en1']);
    const ethernet = host.interfaces.find((item) => item.device === 'en0');
    const wifi = host.interfaces.find((item) => item.device === 'en1');
    assert.strictEqual(ethernet.gateway, '192.168.90.1');
    assert.strictEqual(ethernet.gateway_source, 'dhcp');
    assert.strictEqual(wifi.gateway, '192.168.4.1');
    assert.strictEqual(wifi.gateway_source, 'subnet-gateway');
    assert.notStrictEqual(wifi.gateway, '192.168.90.1');
  });

  await checkAsync('virtual interfaces get no probe targets', async () => {
    const calls = [];
    const ports = [
      'Hardware Port: Ethernet',
      'Device: en0',
      'Ethernet Address: aa:bb:cc:dd:ee:01',
      '',
      'Hardware Port: Wi-Fi',
      'Device: en1',
      'Ethernet Address: 68:4a:76:10:00:01'
    ].join('\n');
    const ifconfigText = [
      'en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.90.50 netmask 0xffffff00 broadcast 192.168.90.255',
      '\tstatus: active',
      'en1: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.4.20 netmask 0xffffff00 broadcast 192.168.4.255',
      '\tstatus: active',
      'feth1234: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 2800',
      '\tinet 10.147.17.5 netmask 0xffffff00 broadcast 10.147.17.255',
      '\tstatus: active',
      'tap0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 10.8.0.6 netmask 0xffffff00 broadcast 10.8.0.255',
      '\tstatus: active',
      'en9: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 10.99.0.8 netmask 0xffffff00 broadcast 10.99.0.255',
      '\tstatus: active'
    ].join('\n');
    const runCommand = async (file, args) => {
      const argv = args || [];
      calls.push([file, ...argv]);
      if (file === 'networksetup') return { stdout: ports, ok: true, spawnError: false };
      if (file === 'ifconfig') return { stdout: ifconfigText, ok: true, spawnError: false };
      if (file === 'route') return { stdout: 'gateway: 10.147.17.1\ninterface: feth1234\n', ok: true, spawnError: false };
      if (file === 'ipconfig') return { stdout: '\n', ok: true, spawnError: false };
      if (file === 'arp') return { stdout: '', ok: true, spawnError: false };
      if (file === 'dns-sd') return { stdout: '', ok: false, spawnError: false, timedOut: true };
      if (file === 'ping') return { stdout: PING, ok: true, spawnError: false };
      if (file === 'networkQuality') return { stdout: QUALITY, ok: true, spawnError: false };
      throw new Error(`unexpected ${file} ${argv.join(' ')}`);
    };
    const host = await loadHost({ runCommand });
    assert.deepStrictEqual(host.interfaces.map((item) => item.device), ['en0', 'en1']);
    assert.strictEqual(host.route.interface, 'feth1234');
    assert.deepStrictEqual(host.interfaces.map((item) => item.gateway), ['192.168.90.1', '192.168.4.1']);
    const fetched = [];
    const discovered = await discover({}, {
      platform: 'darwin',
      runCommand,
      ssdpSearch: async () => ([
        { server: 'zt', location: 'http://10.147.17.1/rootDesc.xml', st: 'ssdp:all', usn: 'zt', address: '10.147.17.1' },
        { server: 'ovpn', location: 'http://10.8.0.1/rootDesc.xml', st: 'ssdp:all', usn: 'ovpn', address: '10.8.0.1' },
        { server: 'extra', location: 'http://10.99.0.1/rootDesc.xml', st: 'ssdp:all', usn: 'extra', address: '10.99.0.1' },
        { server: 'gw', location: 'http://192.168.90.1/rootDesc.xml', st: 'ssdp:all', usn: 'gw', address: '192.168.90.1' }
      ]),
      httpGet: async (location) => {
        fetched.push(location);
        return { ok: true, status: 200, headers: {}, body: UPNP };
      }
    });
    assert.deepStrictEqual(discovered.host.interfaces.map((item) => item.device), ['en0', 'en1']);
    assert.deepStrictEqual(fetched, ['http://192.168.90.1/rootDesc.xml']);
    for (const ip of VIRTUAL_IPS) {
      assert.ok(discovered.skipped_probes.some((item) => String(item.target).includes(ip)), ip);
    }
    const fingerprints = [];
    await routerDetect({}, {
      platform: 'darwin',
      runCommand,
      discoverResult: discovered,
      httpGet: async (location) => {
        fingerprints.push(location);
        return { ok: false, status: 404, headers: {}, body: '' };
      }
    });
    assert.ok(fingerprints.length > 0);
    assert.ok(fingerprints.every((url) => /192\.168\.(90\.1|4\.1)/.test(url)));
    const measured = await speedTest({ interface: 'all' }, { platform: 'darwin', runCommand });
    assert.deepStrictEqual(measured.interfaces.map((item) => item.device), ['en1', 'en0']);
    const pingHosts = calls.filter((parts) => parts[0] === 'ping').map((parts) => parts[parts.length - 1]);
    assert.deepStrictEqual(pingHosts, ['192.168.4.1', '192.168.90.1']);
    for (const parts of calls) {
      const text = parts.join(' ');
      for (const name of VIRTUAL) assert.ok(!new RegExp(`\\b${name}\\b`).test(text), text);
    }
  });
}

module.exports = { run };
