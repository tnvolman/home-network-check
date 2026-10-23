'use strict';

function decodeEntities(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function stripDoctype(xml) {
  return String(xml || '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
}

function textOf(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = re.exec(xml);
  if (!match) return null;
  const inner = match[1].replace(/<[^>]+>/g, '').trim();
  if (!inner) return null;
  return decodeEntities(inner).slice(0, 200);
}

function parseUpnpDescription(xml) {
  const clean = stripDoctype(xml);
  if (!clean.trim()) return null;
  return {
    friendly_name: textOf(clean, 'friendlyName'),
    manufacturer: textOf(clean, 'manufacturer'),
    model: textOf(clean, 'modelName'),
    model_number: textOf(clean, 'modelNumber'),
    model_description: textOf(clean, 'modelDescription'),
    device_type: textOf(clean, 'deviceType'),
    udn: textOf(clean, 'UDN')
  };
}

module.exports = { parseUpnpDescription, stripDoctype };
