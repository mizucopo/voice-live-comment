import { describe, it, expect } from 'vitest';
import { trimText, parseDictionaryRules, applyDictionary } from '../../src/utils/text.js';

describe('trimText', () => {
  it('前後のスペースを除去する', () => {
    expect(trimText('  hello world  ')).toBe('hello world');
  });

  it('連続スペースを1つにする', () => {
    expect(trimText('hello    world')).toBe('hello world');
  });

  it('空文字をそのまま返す', () => {
    expect(trimText('')).toBe('');
  });

  it('スペースのみを空文字にする', () => {
    expect(trimText('   ')).toBe('');
  });

  it('タブ文字も処理する', () => {
    expect(trimText('\thello\tworld\t')).toBe('hello world');
  });

  it('改行をスペースに変換する', () => {
    expect(trimText('hello\nworld')).toBe('hello world');
  });

  it('正常なテキストはそのまま', () => {
    expect(trimText('hello world')).toBe('hello world');
  });

  it('null入力に対して空文字を返す', () => {
    expect(trimText(null)).toBe('');
  });

  it('undefined入力に対して空文字を返す', () => {
    expect(trimText(undefined)).toBe('');
  });
});

describe('parseDictionaryRules', () => {
  it('正しい形式のルールをパースする', () => {
    const text = 'とーきょー→東京\nぶろっこりー→ブロッコリー';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([
      { from: 'とーきょー', to: '東京' },
      { from: 'ぶろっこりー', to: 'ブロッコリー' }
    ]);
  });

  it('空行を無視する', () => {
    const text = 'とーきょー→東京\n\nぶろっこりー→ブロッコリー\n';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([
      { from: 'とーきょー', to: '東京' },
      { from: 'ぶろっこりー', to: 'ブロッコリー' }
    ]);
  });

  it('コメント行（#始まり）を無視する', () => {
    const text = '# コメント\nとーきょー→東京';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([{ from: 'とーきょー', to: '東京' }]);
  });

  it('fromが空のルールを無視する', () => {
    const text = '→東京\nとーきょー→東京';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([{ from: 'とーきょー', to: '東京' }]);
  });

  it('矢印がない行を無視する', () => {
    const text = '無効な行\nとーきょー→東京';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([{ from: 'とーきょー', to: '東京' }]);
  });

  it('空文字は空配列を返す', () => {
    expect(parseDictionaryRules('')).toEqual([]);
    expect(parseDictionaryRules('   ')).toEqual([]);
  });

  it('null/undefinedは空配列を返す', () => {
    expect(parseDictionaryRules(null)).toEqual([]);
    expect(parseDictionaryRules(undefined)).toEqual([]);
  });

  it('矢印の前後の空白をtrimする', () => {
    const text = 'とーきょー → 東京\nぶろっこりー  →  ブロッコリー';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([
      { from: 'とーきょー', to: '東京' },
      { from: 'ぶろっこりー', to: 'ブロッコリー' }
    ]);
  });
});

describe('applyDictionary', () => {
  it('ルールに従って置換する', () => {
    const rules = [
      { from: 'とーきょー', to: '東京' },
      { from: 'ぶろっこりー', to: 'ブロッコリー' }
    ];
    expect(applyDictionary('とーきょーのぶろっこりー', rules)).toBe('東京のブロッコリー');
  });

  it('ルールが空の場合は元のテキストを返す', () => {
    expect(applyDictionary('こんにちは', [])).toBe('こんにちは');
  });

  it('同じパターンが複数あっても全て置換する', () => {
    const rules = [{ from: 'aa', to: 'bb' }];
    expect(applyDictionary('aaとaa', rules)).toBe('bbとbb');
  });

  it('rulesがnullの場合は元のテキストを返す', () => {
    expect(applyDictionary('こんにちは', null)).toBe('こんにちは');
  });

  it('rulesがundefinedの場合は元のテキストを返す', () => {
    expect(applyDictionary('こんにちは', undefined)).toBe('こんにちは');
  });
});
