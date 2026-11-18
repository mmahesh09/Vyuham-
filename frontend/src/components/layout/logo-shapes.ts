/**
 * The Vyuham mark, drawn on a 660 x 660 grid: three pieces forming around an open centre.
 * Plain data, so the app logo and the generated share images use one drawing. src/app/icon.svg repeats it.
 */
export const LOGO_VIEW_BOX = "0 0 660 660";

export const LOGO_PIECES = [
  {
    key: "left",
    d: "M259 37V171L124 284L40 211Z",
    from: [259, 37],
    to: [112, 270],
    stops: [["0", "#FFB81F"], ["1", "#F55A05"]],
  },
  {
    key: "right",
    d: "M401 37L620 211L536 284L401 171Z",
    from: [401, 37],
    to: [548, 270],
    stops: [["0", "#FFB11C"], ["0.65", "#F96A08"], ["1", "#C8400A"]],
  },
  {
    key: "base",
    d: "M14 245L199 406V492Q199 516 223 516H437Q461 516 461 492V406L646 245V403L409 623H251L14 403Z",
    from: [330, 245],
    to: [330, 623],
    stops: [["0", "#FFB01B"], ["0.62", "#FB7A0A"], ["1", "#F76505"]],
  },
] as const;
