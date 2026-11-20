import {
  ORB_MARGIN,
  ORB_SIZE,
  clampOrbPosition,
  defaultOrbPosition,
  panelSide,
  parseOrbPosition,
  serializeOrbPosition,
} from './settings-orb';

const window = { width: 390, height: 844 };
const insets = { top: 47, bottom: 34, left: 0, right: 0 };

describe('defaultOrbPosition', () => {
  it('sits in the bottom-right corner, inside the safe area', () => {
    expect(defaultOrbPosition({ window, insets })).toEqual({
      x: window.width - ORB_SIZE - ORB_MARGIN,
      y: window.height - insets.bottom - ORB_SIZE - ORB_MARGIN,
    });
  });
});

describe('clampOrbPosition', () => {
  it('leaves a legal position alone', () => {
    const position = { x: 100, y: 400 };

    expect(clampOrbPosition({ position, window, insets })).toEqual(position);
  });

  it('pulls an orb dragged past every edge back inside', () => {
    expect(clampOrbPosition({ position: { x: -500, y: -500 }, window, insets })).toEqual({
      x: insets.left + ORB_MARGIN,
      y: insets.top + ORB_MARGIN,
    });

    expect(clampOrbPosition({ position: { x: 9_999, y: 9_999 }, window, insets })).toEqual({
      x: window.width - ORB_SIZE - ORB_MARGIN,
      y: window.height - insets.bottom - ORB_SIZE - ORB_MARGIN,
    });
  });

  it('re-clamps after a rotation shrinks the window', () => {
    // Landscape on the same device: the x from portrait is now off screen.
    const landscape = { width: 844, height: 390 };

    expect(
      clampOrbPosition({ position: { x: 900, y: 700 }, window: landscape, insets }),
    ).toEqual({
      x: landscape.width - ORB_SIZE - ORB_MARGIN,
      y: landscape.height - insets.bottom - ORB_SIZE - ORB_MARGIN,
    });
  });
});

describe('parseOrbPosition', () => {
  it('round-trips a stored position', () => {
    expect(parseOrbPosition(serializeOrbPosition({ x: 12.4, y: 300.6 }))).toEqual({
      x: 12,
      y: 301,
    });
  });

  it('falls back for anything unreadable', () => {
    expect(parseOrbPosition(null)).toBeNull();
    expect(parseOrbPosition('')).toBeNull();
    expect(parseOrbPosition('not json')).toBeNull();
    expect(parseOrbPosition('{"x":1}')).toBeNull();
    expect(parseOrbPosition('{"x":"1","y":2}')).toBeNull();
    expect(parseOrbPosition('{"x":null,"y":2}')).toBeNull();
  });
});

describe('panelSide', () => {
  it('opens above and to the left of a bottom-right orb', () => {
    expect(panelSide({ x: 330, y: 766 }, window)).toEqual({
      horizontal: 'left',
      vertical: 'above',
    });
  });

  it('opens below and to the right of a top-left orb', () => {
    expect(panelSide({ x: 16, y: 60 }, window)).toEqual({
      horizontal: 'right',
      vertical: 'below',
    });
  });
});
