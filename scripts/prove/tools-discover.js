'use strict';

const assert = require('assert');
const subnet = require('../../server/subnet');
const ifconfig = require('../../server/parsers/ifconfig');
const { discover, MAX_LOCATION_FETCHES, DISCOVER_BUDGET_MS } = require('../../server/tools/discover');
const { checkAsync } = require('./harness');
const { LAN, UPNP, lanHost } = require('./fixtures');

async function run() {
  await checkAsync('discover fetches only in-subnet UPnP descriptions', async () => {
    const fetched = [];
    let searched = false;
    const result = await discover({}, {
      platform: 'darwin',
      loadHost: async () => lanHost(),
      runCommand: async (file) => {
        if (file === 'arp') {
          return {
            stdout: '? (192.168.1.1) at 00:15:6d:aa:bb:cc on en0 ifscope [ethernet]\n? (8.8.8.8) at aa:bb:cc:dd:ee:01 on en0 ifscope [ethernet]\n',
            ok: true,
            spawnError: false,
            timedOut: false
          };
        }
        if (file === 'dns-sd') {
          return { stdout: 'Add 3 11 local. _eero._tcp. _eero._tcp\n', ok: false, spawnError: false, timedOut: true };
        }
        throw new Error(`unexpected ${file}`);
      },
      ssdpSearch: async () => {
        searched = true;
        return [
          { server: 'eero/1.0', location: 'http://8.8.8.8/rootDesc.xml', st: 'ssdp:all', usn: 'pub', address: '8.8.8.8' },
          { server: 'eero/1.0', location: 'http://192.168.1.1:5000/rootDesc.xml', st: 'ssdp:all', usn: 'gw', address: '192.168.1.1' },
          { server: 'x', location: 'http://user:pass@192.168.1.1/rootDesc.xml', st: 'x', usn: 'auth', address: '192.168.1.1' },
          { server: 'x', location: 'http://router.local/rootDesc.xml', st: 'x', usn: 'name', address: '192.168.1.9' },
          { server: 'x', location: 'http://192.168.2.1/rootDesc.xml', st: 'x', usn: 'other', address: '192.168.2.1' }
        ];
      },
      httpGet: async (location) => {
        fetched.push(location);
        assert.strictEqual(subnet.evaluateTarget(location, LAN).ok, true);
        return { ok: true, status: 200, headers: {}, body: UPNP };
      }
    });
    assert.strictEqual(searched, true);
    assert.deepStrictEqual(fetched, ['http://192.168.1.1:5000/rootDesc.xml']);
    assert.ok(result.skipped_probes.some((item) => item.target.includes('8.8.8.8')));
    assert.ok(result.probes.filter((item) => item.allowed && item.kind === 'upnp-description').every((item) => item.target.startsWith('192.168.1.1')));
    const gateway = result.devices.find((item) => item.ip === '192.168.1.1');
    assert.strictEqual(gateway.vendor_guess, 'eero');
    assert.strictEqual(gateway.probed, true);
    const outsider = result.arp.find((item) => item.ip === '8.8.8.8');
    assert.strictEqual(outsider.in_local_subnet, false);
    let ssdpCalled = false;
    const blocked = await discover({}, {
      platform: 'linux',
      ssdpSearch: async () => { ssdpCalled = true; return []; },
      httpGet: async () => { ssdpCalled = true; return {}; },
      runCommand: async () => { throw new Error('spawned'); }
    });
    assert.strictEqual(blocked.error, 'unsupported OS');
    assert.strictEqual(ssdpCalled, false);
  });

  await checkAsync('discover ignores a VPN 10/8 and caps location fetches', async () => {
    assert.strictEqual(MAX_LOCATION_FETCHES, 16);
    assert.ok(DISCOVER_BUDGET_MS > 0);
    const ifconfigText = [
      'en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.1.42 netmask 0xffffff00 broadcast 192.168.1.255',
      '\tstatus: active',
      'en5: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
      '\tinet 192.168.50.20 netmask 0xffffff00 broadcast 192.168.50.255',
      '\tstatus: active',
      'utun3: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1380',
      '\tinet 10.0.0.2 --> 10.0.0.1 netmask 0xff000000'
    ].join('\n');
    const parsedUtun = ifconfig.parseIfconfig(ifconfigText).find((item) => item.device === 'utun3');
    assert.strictEqual(parsedUtun.addresses[0].address, '10.0.0.2');
    assert.strictEqual(parsedUtun.addresses[0].netmask, '255.0.0.0');
    const fetched = [];
    const result = await discover({}, {
      platform: 'darwin',
      runCommand: async (file) => {
        if (file === 'route') {
          return { stdout: 'gateway: 192.168.1.1\ninterface: en0\n', ok: true, spawnError: false };
        }
        if (file === 'ifconfig') return { stdout: ifconfigText, ok: true, spawnError: false };
        if (file === 'arp') return { stdout: '', ok: true, spawnError: false };
        if (file === 'dns-sd') return { stdout: '', ok: false, spawnError: false, timedOut: true };
        throw new Error(`unexpected ${file}`);
      },
      ssdpSearch: async () => ([
        { server: 'vpn', location: 'http://10.1.2.3/rootDesc.xml', st: 'ssdp:all', usn: 'vpn', address: '10.1.2.3' },
        { server: 'other', location: 'http://192.168.50.2/rootDesc.xml', st: 'ssdp:all', usn: 'other', address: '192.168.50.2' },
        { server: 'gw', location: 'http://192.168.1.1/rootDesc.xml', st: 'ssdp:all', usn: 'gw', address: '192.168.1.1' }
      ]),
      httpGet: async (location) => {
        fetched.push(location);
        return { ok: true, status: 200, headers: {}, body: UPNP };
      }
    });
    assert.deepStrictEqual(result.host.interfaces.map((item) => item.device), ['en0', 'en5']);
    assert.deepStrictEqual(fetched, ['http://192.168.50.2/rootDesc.xml', 'http://192.168.1.1/rootDesc.xml']);
    assert.ok(result.skipped_probes.some((item) => item.target.includes('10.1.2.3')));
    assert.ok(!result.skipped_probes.some((item) => item.target.includes('192.168.50.2')));

    const many = [];
    const capped = await discover({}, {
      platform: 'darwin',
      loadHost: async () => lanHost(),
      runCommand: async (file) => {
        if (file === 'arp' || file === 'dns-sd') return { stdout: '', ok: true, spawnError: false, timedOut: false };
        throw new Error(`unexpected ${file}`);
      },
      ssdpSearch: async () => Array.from({ length: 20 }, (_, index) => ({
        server: 'dev',
        location: `http://192.168.1.1:${8000 + index}/desc.xml`,
        st: 'ssdp:all',
        usn: `u${index}`,
        address: '192.168.1.1'
      })),
      httpGet: async (location) => {
        many.push(location);
        return { ok: true, status: 200, headers: {}, body: UPNP };
      }
    });
    assert.strictEqual(many.length, 16);
    assert.ok(capped.skipped_probes.filter((item) => item.reason === 'location fetch cap').length >= 4);

    let clock = 0;
    const timed = [];
    await discover({}, {
      platform: 'darwin',
      loadHost: async () => lanHost(),
      now: () => clock,
      runCommand: async () => ({ stdout: '', ok: true, spawnError: false, timedOut: false }),
      ssdpSearch: async () => ([
        { server: 'a', location: 'http://192.168.1.1/a.xml', st: 'ssdp:all', usn: 'a', address: '192.168.1.1' },
        { server: 'b', location: 'http://192.168.1.1/b.xml', st: 'ssdp:all', usn: 'b', address: '192.168.1.1' },
        { server: 'c', location: 'http://192.168.1.1/c.xml', st: 'ssdp:all', usn: 'c', address: '192.168.1.1' }
      ]),
      httpGet: async (location) => {
        timed.push(location);
        clock = DISCOVER_BUDGET_MS + 1;
        return { ok: true, status: 200, headers: {}, body: UPNP };
      }
    });
    assert.deepStrictEqual(timed, ['http://192.168.1.1/a.xml']);
  });
}

module.exports = { run };
