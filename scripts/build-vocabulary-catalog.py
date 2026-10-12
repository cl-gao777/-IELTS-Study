"""Compile checked, original learning cards against the licensed source members."""
import argparse
import hashlib
import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'src' / 'data'
ORIGINAL = 'IELTS Studio 原创学习例句（非雅思试题）'
CONTENT_VERSION = 3
VARIANTS = {
    'center': 'centre', 'color': 'colour', 'favor': 'favour', 'favorite': 'favourite',
    'behavior': 'behaviour', 'labor': 'labour', 'neighbor': 'neighbour', 'honor': 'honour',
    'analyze': 'analyse', 'organize': 'organise', 'recognize': 'recognise',
    'realize': 'realise', 'organization': 'organisation', 'emphasize': 'emphasise',
    'defense': 'defence', 'offense': 'offence', 'gray': 'grey', 'theater': 'theatre',
    'liter': 'litre', 'meter': 'metre', 'catalog': 'catalogue', 'program': 'programme',
    'fulfill': 'fulfil', 'traveling': 'travelling', 'canceled': 'cancelled',
    'counselor': 'counsellor', 'fiber': 'fibre', 'humor': 'humour', 'criticize': 'criticise',
    'summarize': 'summarise', 'specialize': 'specialise', 'apologize': 'apologise',
}
# Corrections/supplements are our descriptions, explicitly separate from source definitions.
DEFINITIONS = {
    'email': 'An electronic message sent over a computer network; to send such a message.',
    'cheer': 'To shout encouragement or express happiness; a shout of encouragement.',
    'descendent': 'A person, animal, or plant descended from an earlier ancestor.',
    'he': 'The pronoun used as the subject for a male person already mentioned.',
    'as': 'In the role or capacity of; used to compare equal qualities.',
    'some': 'An unspecified amount or number of something.',
    'week': 'A period of seven days.',
    'program': 'An organised set of activities or instructions for a computer.',
    'process': 'To treat material or information using a series of operations.',
    'price': 'To decide how much money to charge for something.',
    'else': 'In addition or instead; used after words such as who, what, and somewhere.',
    'please': 'A polite expression used when asking someone to do something.',
    'distribution': 'The way something is spread among places or people; the act of supplying or giving it out.',
    'headquarter': 'To establish the main office or centre of an organisation in a particular place.',
    'ex': 'A prefix meaning former, as in ex-president; in some other formations, out of or from.',
    'star': 'A large ball of hot gas in space that produces its own light.',
    'software': 'Programs and instructions used by a computer.',
    'regard': 'Care, attention, or respect for someone or something.',
    'cancer': 'A disease in which abnormal cells grow uncontrollably and may spread to other parts of the body.',
    'tumor': 'An abnormal mass of tissue, which may be benign or cancerous.',
    'fungus': 'An organism such as a mushroom, mould, or yeast that absorbs nutrients from organic matter.',
    'dioxide': 'An oxide containing two oxygen atoms in each molecule.',
    'rid': 'To free someone or something from an unwanted thing.',
    'compose': 'To write or create music or a piece of writing; to form or make up something.',
    'moon': "The Earth's natural satellite, visible by reflected sunlight.",
    'artificial': 'Made by people rather than occurring naturally.',
    'amino': 'Relating to an amino group or amino acids.',
    'atom': 'The smallest unit of a chemical element that retains its chemical properties.',
    'algorithm': 'A step-by-step procedure or set of rules for solving a problem.',
    'chloride': 'A compound containing chlorine combined with another element, or the chloride ion.',
    'capitalism': 'An economic system based on private ownership of businesses and the means of production.',
    'capitalist': 'A person who owns or invests capital in a business, or supports capitalism.',
    'constrain': 'To limit or restrict what someone or something can do.',
    'wherever': 'In, at, or to any place; in every place where.',
    'stair': 'A step in a set of steps leading from one level to another.',
    'nerve': 'A bundle of fibres that carries signals between the brain or spinal cord and the body.',
    'organic': 'Relating to living things or carbon-based compounds; for food, produced using organic farming methods.',
    'rose': 'A flowering shrub, or its flower, which has layered petals and is often fragrant.',
    'theoretical': 'Based on ideas or principles rather than practical use or experience.',
    'amplitude': 'The greatest displacement or variation from an equilibrium value, as in a wave or vibration.',
    'antibiotic': 'A medicine that kills bacteria or inhibits their growth.',
    'capillary': 'A very small blood vessel connecting the smallest arteries and veins.',
    'acid': 'A substance that can donate hydrogen ions; many acids have a sour taste and react with bases.',
    'assignment': 'A task or piece of work given to someone to complete.',
    'bound': 'Certain or very likely to happen; travelling towards a particular place.',
    'cognitive': 'Relating to mental processes such as thinking, knowing, remembering, and learning.',
    'complication': 'An additional problem that makes a situation more difficult.',
    'consumption': 'The use of resources or goods; the act of eating or drinking.',
}


def normalise(value):
    return re.sub(r'\s+', ' ', value.strip().lower().replace('’', "'").replace('‘', "'"))


def assemble(source_directory, development=False):
    canonical = json.loads((source_directory / 'canonical.json').read_text(encoding='utf-8'))
    members = {normalise(entry['term']): entry for entry in canonical['entries']}
    assert len(members) == 3766 and canonical['counts'] == {'general': 2809, 'academic': 957}
    authored = {}
    for filename in sorted((DATA / 'vocabulary-authored').glob('*.json')):
        rows = json.loads(filename.read_text(encoding='utf-8'))
        for row in rows:
            if not isinstance(row, list) or len(row) != 5 or any(not isinstance(v, str) or not v.strip() for v in row):
                raise ValueError(f'Invalid author record in {filename.name}: {row!r}')
            term = normalise(row[0])
            if term not in members or term in authored:
                raise ValueError(f'Unknown or duplicate authored word: {term}')
            authored[term] = row
    missing = sorted(set(members) - set(authored))
    if missing and not development:
        raise ValueError(f'{len(missing)} missing authored records, first: {missing[:15]}')
    entries = []
    for term, member in members.items():
        if term not in authored:
            continue
        _, meaning, pos, first, second = authored[term]
        if normalise(first) == normalise(second):
            raise ValueError(f'Duplicate examples: {term}')
        exercises = []
        for number, sentence in enumerate([first, second], 1):
            matches = list(re.finditer(r'(?<![A-Za-z])' + re.escape(term) + r'(?![A-Za-z])', sentence, re.I))
            if not matches or len(re.findall(r"[A-Za-z]+(?:'[a-z]+)?", sentence)) < 4:
                raise ValueError(f'Unusable context for {term}: {sentence}')
            if re.search(r'\b(?:the word|word means|means that|fill in|target word)\b', sentence, re.I):
                raise ValueError(f'Metalinguistic placeholder example: {term}')
            match = matches[0]
            target = match.group()
            variants = [target]
            alternative = VARIANTS.get(term) or next((key for key, value in VARIANTS.items() if value == term), None)
            # programme is a spelling variant for the non-computing sense only.
            if term == 'program' and re.search(r'computer|software|data|code', sentence, re.I):
                alternative = None
            if alternative:
                variants.append(alternative)
            exercises.append({'id': f'public:{term}:context:{number}', 'version': CONTENT_VERSION, 'status': 'published',
                'sentence': sentence, 'targetStart': match.start(), 'targetEnd': match.end(),
                'targetSurface': target, 'acceptedAnswers': variants, 'meaningZh': meaning, 'source': ORIGINAL})
        definition = DEFINITIONS.get(term) or member['definitionEn']
        if not definition or re.search(r'#(?:NAME|VALUE|REF|N/A)|^undefined$|^nan$', definition, re.I):
            raise ValueError(f'Missing English definition: {term}')
        list_name = 'NGSL' if member['courseId'] == 'general' else 'NAWL'
        entries.append({'id': f'public:{term}', 'version': CONTENT_VERSION, 'term': term, 'pronunciation': '', 'partOfSpeech': pos,
            'meaningZh': meaning, 'definitionEn': definition, 'example': first, 'tags': ['雅思备考', list_name],
            'lemma': term, 'ipa': '', 'sourceSentence': '', 'sourceMaterial': f'{list_name} 1.2 · New General Service List Project · CC BY-SA 4.0',
            'collocations': [], 'synonyms': [], 'antonyms': [], 'wordFamily': [],
            'notes': '中文释义和两道语境题为 IELTS Studio 原创学习资料；英文释义来自公开词表，少量订正／缺项补充见来源清单。',
            'courseIds': [member['courseId']], 'rank': member['rank'], 'exercises': exercises, 'status': 'published'})
    catalog = {'courses': [
        {'id': 'general', 'title': '雅思备考词库 · 基础（NGSL 1.2）', 'description': '2,809 个基础词，按词频排序。公开 NGSL 1.2；原创中文释义和语境例句。Browne、Culligan、Phillips，CC BY-SA 4.0。并非官方雅思考纲词表。', 'kind': 'builtin', 'version': 3},
        {'id': 'academic', 'title': '雅思备考词库 · 学术（NAWL 1.2）', 'description': '957 个学术词，按官方字母词表顺序。公开 NAWL 1.2；原创中文释义和语境例句。Browne、Culligan、Phillips，CC BY-SA 4.0。并非官方雅思考纲词表。', 'kind': 'builtin', 'version': 3}], 'entries': entries}
    DATA.mkdir(exist_ok=True)
    catalog_bytes = (json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    (DATA / 'vocabulary-catalog.json').write_bytes(catalog_bytes)
    source_snapshot = DATA / 'vocabulary-sources'
    source_snapshot.mkdir(exist_ok=True)
    for filename in source_directory.iterdir():
        if filename.is_file():
            shutil.copyfile(filename, source_snapshot / filename.name)
    manifest = {key: value for key, value in canonical.items() if key != 'entries'}
    manifest.update({'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
        'sourcePages': ['https://www.newgeneralservicelist.com/new-general-service-list', 'https://www.newgeneralservicelist.com/new-academic-word-list'],
        'contentVersion': CONTENT_VERSION, 'complete': not missing, 'publishedEntries': len(entries), 'publishedExercises': 2 * len(entries),
        'catalogSha256': hashlib.sha256(catalog_bytes).hexdigest(),
        'adaptations': {'chineseMeanings': 'IELTS Studio 原创', 'contextExamples': ORIGINAL,
            'definitionCorrectionsAndSupplements': DEFINITIONS},
        'missingAuthoredCount': len(missing)})
    (DATA / 'vocabulary-source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'complete': not missing, 'entries': len(entries), 'exercises': 2 * len(entries), 'missing': len(missing)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source_directory', type=pathlib.Path)
    parser.add_argument('--development', action='store_true', help='Allow incomplete content ONLY in development; never ship this output.')
    options = parser.parse_args()
    assemble(options.source_directory, options.development)
