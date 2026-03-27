import { describe, it, expect } from 'vitest';
import { trimText } from '../../src/utils/text.js';

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
