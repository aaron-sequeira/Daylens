import { describe, it, expect } from 'vitest';
import { redact, MAX_READ_TEXT } from './redact';

describe('redact', () => {
  it.each([
    ['mail me at aaron.s+work@example.co.uk now', 'mail me at [email] now'],
    ['card 4111 1111 1111 1111 exp', 'card [number] exp'],
    ['card 4111-1111-1111-1111', 'card [number]'],
    ['call +91 98765 43210', 'call +[number]'],
    ['code 12345678', 'code [number]'],
    ['key sk-proj-abcdefghijklmnop1234 end', 'key [secret] end'],
    ['token ghp_0123456789abcdefghijABCDEFGHIJ', 'token [secret]'],
    ['pat github_pat_11ABCDEFG0123456789_abcdefghijk', 'pat [secret]'],
    ['aws AKIAIOSFODNN7EXAMPLE', 'aws [secret]'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123', 'jwt [secret]'],
    ['sha da39a3ee5e6b4b0d3255bfef95601890afd80709', 'sha [secret]'],
    ['b64 QWxhZGRpbjpvcGVuIHNlc2FtZQ9876543210abcd==', 'b64 [secret]']
  ])('redacts %s', (input, expected) => {
    expect(redact(input)).toBe(expected);
  });
  it('keeps ordinary text, short numbers and long plain words', () => {
    const t = 'Room 101 on floor 3, pneumonoultramicroscopicsilicovolcanoconiosis is long, 2FA code 123456';
    expect(redact(t)).toBe(t);
  });
  it('truncates to 4000 characters after redaction', () => {
    expect(redact('x '.repeat(5000))).toHaveLength(MAX_READ_TEXT);
  });
});
