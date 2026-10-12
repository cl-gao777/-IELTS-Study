"""Fetch official open word-list snapshots; no learner data or credentials are used."""
import argparse
import csv
import datetime
import hashlib
import io
import json
import pathlib
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

URLS = {
    'ngsl-members': 'https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv',
    'ngsl-definitions': 'https://www.newgeneralservicelist.com/s/NGSL_12_with_English_definitions.xlsx',
    'nawl-members': 'https://www.newgeneralservicelist.com/s/NAWL_12_alphabetized_description.txt',
    'nawl-definitions': 'https://www.newgeneralservicelist.com/s/NAWL_12_with_en_definitions.csv',
}
LICENSE = 'CC-BY-SA-4.0'


def xlsx_rows(data):
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        strings = [''.join(node.itertext()) for node in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', ns)]
        result = []
        for row in ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('.//s:sheetData/s:row', ns):
            cells = {}
            for cell in row.findall('s:c', ns):
                node = cell.find('s:v', ns)
                value = node.text if node is not None else ''
                if cell.get('t') == 's':
                    value = strings[int(value)]
                cells[re.sub(r'\d', '', cell.get('r', ''))] = value
            result.append([cells.get('A', ''), cells.get('B', '')])
        return result


def normalise(value):
    return re.sub(r'\s+', ' ', value.strip().lower().replace('’', "'").replace('‘', "'"))


def acquire(directory):
    directory.mkdir(parents=True, exist_ok=True)
    raw = {}
    manifest = []
    for name, url in URLS.items():
        dest = directory / (name + pathlib.PurePosixPath(url).suffix)
        if dest.exists():
            data = dest.read_bytes()
        else:
            request = urllib.request.Request(url, headers={'User-Agent': 'IELTS-Studio/0.3 open-vocabulary-builder'})
            with urllib.request.urlopen(request, timeout=45) as response:
                data = response.read()
            dest.write_bytes(data)
        raw[name] = data
        manifest.append({'id': name, 'url': url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'license': LICENSE})
    ngsl_rows = list(csv.DictReader(io.StringIO(raw['ngsl-members'].decode('utf-8-sig'))))
    ngsl_definitions = {normalise(row[0]): row[1].strip() for row in xlsx_rows(raw['ngsl-definitions'])[1:] if row[0]}
    lines = raw['nawl-members'].decode('utf-8-sig').splitlines()
    # The downloadable document starts with prose and References, then the actual list.
    first_word = next(i for i, line in enumerate(lines) if line.strip() == 'abdominal')
    nawl_words = [normalise(line) for line in lines[first_word:] if line.strip()]
    if any(not re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*", term) for term in nawl_words):
        raise ValueError('Unexpected NAWL member or footer; review the source before updating the snapshot.')
    nawl_definition_rows = list(csv.DictReader(io.StringIO(raw['nawl-definitions'].decode('utf-8-sig'))))
    nawl_definitions = {normalise(row['Meanings']): (row['English Definition'].strip(), row['POS'].strip()) for row in nawl_definition_rows}
    entries = []
    for row in ngsl_rows:
        term = normalise(row['Lemma'])
        entries.append({'term': term, 'courseId': 'general', 'rank': int(float(row['SFI Rank'])), 'definitionEn': ngsl_definitions.get(term, ''), 'sourcePartOfSpeech': ''})
    for rank, term in enumerate(nawl_words, 1):
        definition, pos = nawl_definitions.get(term, ('', ''))
        entries.append({'term': term, 'courseId': 'academic', 'rank': rank, 'definitionEn': definition, 'sourcePartOfSpeech': pos})
    terms = [entry['term'] for entry in entries]
    if len(set(terms)) != len(terms):
        raise ValueError('The source lists overlap or contain duplicate members; do not silently increase counts.')
    counts = {kind: sum(entry['courseId'] == kind for entry in entries) for kind in ['general', 'academic']}
    missing = [entry['term'] for entry in entries if not entry['definitionEn']]
    result = {'acquiredAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'version': '1.2', 'attribution': 'Browne, C., Culligan, B., and Phillips, J. — New General Service List Project', 'license': LICENSE,
              'sources': manifest, 'counts': counts, 'missingDefinitions': missing,
              'extraNawlDefinitions': sorted(set(nawl_definitions) - set(nawl_words)), 'entries': entries}
    (directory / 'canonical.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    # Frequency order gives natural foundational batches; academic remains official list order.
    ordered = sorted(entries, key=lambda entry: (entry['courseId'] != 'general', entry['rank']))
    batches = directory / 'author-inputs'
    batches.mkdir(exist_ok=True)
    for start in range(0, len(ordered), 100):
        (batches / ('%02d.json' % (start // 100))).write_text(json.dumps(ordered[start:start + 100], ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'counts': counts, 'distinct': len(terms), 'missingDefinitions': missing, 'extraNawlDefinitions': result['extraNawlDefinitions'], 'batchCount': (len(ordered) + 99) // 100}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=pathlib.Path)
    acquire(parser.parse_args().output)
