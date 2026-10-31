import { describe, expect, it } from 'vitest';
import { evalAmount, hasSum, pressKey } from './amount';

describe('the amount keypad', () => {
  it('adds and takes away', () => {
    expect(evalAmount('850')).toBe(85000);
    expect(evalAmount('850+120−50')).toBe(92000);
    expect(evalAmount('10.5+0.25')).toBe(1075);
    expect(evalAmount('100-150')).toBe(-5000);
    expect(evalAmount('')).toBeNull();
    expect(evalAmount('1..2')).toBeNull();
    expect(evalAmount('12+')).toBeNull();
    expect(hasSum('850+1')).toBe(true);
    expect(hasSum('850')).toBe(false);
  });
  it('types sensibly', () => {
    const type = (keys: string[]) => keys.reduce(pressKey, '');
    expect(type(['8', '5', '0'])).toBe('850');
    expect(type(['.', '5'])).toBe('0.5');
    expect(type(['1', '.', '2', '3', '4'])).toBe('1.23');
    expect(type(['1', '.', '.', '2'])).toBe('1.2');
    expect(type(['+'])).toBe('');
    expect(type(['5', '+', '−', '2'])).toBe('5−2');
    expect(type(['0', '0', '7'])).toBe('7');
    expect(type(['5', '0', '0', 'back'])).toBe('50');
    expect(type(['5', '00'])).toBe('500');
  });
});
