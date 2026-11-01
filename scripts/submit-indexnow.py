#!/usr/bin/env python3
"""Notify IndexNow about the public launch pages; default mode is read-only."""
import argparse
import json
from pathlib import Path
import re
import sys
from html.parser import HTMLParser
from urllib import error, request, robotparser
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

PUBLIC_PATHS = ('/', '/how-it-works', '/join', '/contact', '/privacy')
ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PageMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonical = []
        self.blocked = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonical.append(attrs.get('href'))
        if tag == 'meta' and attrs.get('name', '').lower() in ('robots', 'googlebot', 'bingbot'):
            self.blocked |= 'noindex' in attrs.get('content', '').lower()


def configuration():
    values = json.loads((ROOT / 'src/cloudflare/wrangler.launch.jsonc').read_text())['vars']
    origin, key = values['PUBLIC_ORIGIN'], values.get('INDEXNOW_KEY', '')
    parsed = urlsplit(origin)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.path or parsed.query or parsed.fragment
            or parsed.hostname.startswith('daqqa-t-id-staging.')
            or not re.fullmatch(r'[A-Za-z0-9-]{8,128}', key)):
        raise ValueError('Invalid public launch origin or IndexNow proof configuration.')
    return origin, key, parsed.netloc


def run(submit=False):
    origin, key, host = configuration()
    urls = [origin + path for path in PUBLIC_PATHS]
    if not submit:
        print(json.dumps({'mode': 'dry-run', 'origin': origin, 'urlCount': len(urls), 'urls': urls}))
        return

    # Uses inherited proxy/CA settings; no Cloudflare or search-account credential
    # is sent to the public website or IndexNow. The proof key is public by design.
    client = request.build_opener(NoRedirect())

    def read(url):
        req = request.Request(url, headers={'User-Agent': 'DaqqaTid-SearchSetup/1.0'})
        with client.open(req, timeout=30) as response:
            if response.status != 200:
                raise ValueError('Public discovery document is unavailable.')
            body = response.read(131073)
            if len(body) > 131072:
                raise ValueError('Unexpected public document size.')
            return body.decode('utf-8'), response.headers

    robots, _ = read(origin + '/robots.txt')
    policy = robotparser.RobotFileParser()
    policy.parse(robots.splitlines())
    if not all(policy.can_fetch('*', url) for url in urls):
        raise ValueError('Refusing submission: a public launch page is blocked by robots.txt.')
    xml, _ = read(origin + '/sitemap.xml')
    discovered = [element.text for element in ET.fromstring(xml).iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
    if discovered != urls:
        raise ValueError('Refusing submission: the sitemap differs from the five public launch pages.')
    proof, _ = read(f'{origin}/{key}.txt')
    if proof != key:
        raise ValueError('Refusing submission: hosted IndexNow proof does not match.')
    for url in urls:
        body, headers = read(url)
        page = PageMetadata()
        page.feed(body)
        if page.blocked or 'noindex' in headers.get('X-Robots-Tag', '').lower() or page.canonical != [url]:
            raise ValueError('Refusing submission: a page is noindex or has a different canonical URL.')

    payload = json.dumps({'host': host, 'key': key, 'keyLocation': f'{origin}/{key}.txt', 'urlList': urls}).encode()
    req = request.Request('https://api.indexnow.org/indexnow', data=payload, method='POST',
                          headers={'Content-Type': 'application/json', 'User-Agent': 'DaqqaTid-SearchSetup/1.0'})
    with client.open(req, timeout=30) as response:
        if response.status not in (200, 202):
            raise ValueError('IndexNow did not accept the submission.')
        print(json.dumps({'origin': origin, 'urlCount': len(urls), 'httpStatus': response.status,
                          'result': 'received' if response.status == 200 else 'received_pending_key_validation',
                          'indexedOrRanked': 'not_verified'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--submit', action='store_true', help='Validate the deployed public pages and notify IndexNow.')
    args = parser.parse_args()
    try:
        run(args.submit)
    except error.HTTPError as exc:
        print(f'Search setup HTTP failure: {exc.code}. No indexing or ranking is claimed.', file=sys.stderr)
        sys.exit(1)
    except (ValueError, error.URLError, ET.ParseError, KeyError) as exc:
        print(f'Search setup failed: {exc}', file=sys.stderr)
        sys.exit(1)
