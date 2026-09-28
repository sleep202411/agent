import * as Y from 'yjs';
import { screenplayDocumentFromXml } from './story-script-stage';

describe('canonical Script source extraction', () => {
  it('reads formatted text, hard breaks and nested paragraphs without introducing XML or losing whitespace', () => {
    const doc = new Y.Doc();
    const root = doc.getXmlFragment('content');
    const heading = new Y.XmlElement('heading');
    heading.setAttribute('level', '2');
    const paragraph = new Y.XmlElement('paragraph');
    const list = new Y.XmlElement('bulletList');
    const item = new Y.XmlElement('listItem');
    const nested = new Y.XmlElement('paragraph');
    root.insert(0, [heading, paragraph, list]);
    const title = new Y.XmlText();
    heading.insert(0, [title]);
    title.insert(0, '原稿');
    const marked = new Y.XmlText();
    const after = new Y.XmlText();
    paragraph.insert(0, [marked, new Y.XmlElement('hardBreak'), after]);
    marked.insert(0, '  刘鉴：镜可磨，', { bold: {} });
    after.insert(0, '不可毁。  ');
    list.insert(0, [item]);
    item.insert(0, [nested]);
    const rule = new Y.XmlText();
    nested.insert(0, [rule]);
    rule.insert(0, '信任值达到条件');
    expect(screenplayDocumentFromXml(root).blocks).toEqual([
      { kind: 'heading', level: 2, text: '原稿' },
      { kind: 'paragraph', text: '  刘鉴：镜可磨，\n不可毁。  ' },
      { kind: 'paragraph', text: '信任值达到条件' },
    ]);
    doc.destroy();
  });

  it('fails visibly rather than silently omitting an embedded source object', () => {
    const doc = new Y.Doc();
    const root = doc.getXmlFragment('content');
    root.insert(0, [new Y.XmlElement('image')]);
    expect(() => screenplayDocumentFromXml(root)).toThrow(
      'Unsupported Script element',
    );
    doc.destroy();
  });

  it.each(['paragraph', 'heading'])(
    'rejects unsupported embedded content inside a %s without altering the source',
    (kind) => {
      const doc = new Y.Doc();
      try {
        const root = doc.getXmlFragment('content');
        const block = new Y.XmlElement(kind);
        const text = new Y.XmlText();
        const embedded = new Y.XmlElement('image');
        embedded.setAttribute('src', 'https://example.test/reference.png');
        root.insert(0, [block]);
        block.insert(0, [text, embedded]);
        text.insert(0, 'Creator reference:');
        const original = root.toJSON();
        expect(() => screenplayDocumentFromXml(root)).toThrow(
          'Unsupported Script element',
        );
        expect(root.toJSON()).toBe(original);
      } finally {
        doc.destroy();
      }
    },
  );

  it('keeps ordinary empty text blocks valid', () => {
    const doc = new Y.Doc();
    try {
      const root = doc.getXmlFragment('content');
      const paragraph = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      root.insert(0, [new Y.XmlElement('paragraph'), paragraph]);
      paragraph.insert(0, [text]);
      text.insert(0, 'Remaining script');
      expect(screenplayDocumentFromXml(root).blocks).toEqual([
        { kind: 'paragraph', text: 'Remaining script' },
      ]);
    } finally {
      doc.destroy();
    }
  });
});
