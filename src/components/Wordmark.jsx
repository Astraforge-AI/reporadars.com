const letters = {
  r: "M2 67V24M2 35C2 27 8 22 17 24",
  e: "M2 43H19V33C19 20 2 20 2 33V57C2 70 19 70 19 59",
  p: "M2 78V24M2 33C2 20 19 20 19 33V57C19 70 2 70 2 57",
  o: "M2 33C2 20 19 20 19 33V57C19 70 2 70 2 57Z",
  a: "M2 31C2 21 19 21 19 33V67M19 43H11C-1 43-1 67 10 67C16 67 19 60 19 55",
  d: "M19 3V67M19 33C19 20 2 20 2 33V57C2 70 19 70 19 57",
  s: "M18 31C18 20 2 20 2 32C2 42 18 46 18 56C18 71 2 70 2 59",
};
const positions = [0, 22, 47, 72, 97, 118, 143, 168, 193, 214];

// Outlined lettering keeps the brand identical before fonts load and on every route.
export function Wordmark() {
  return (
    <svg
      viewBox="0 0 236 82"
      width="184"
      height="64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {[..."reporadars"].map((letter, index) => (
        <path
          key={index}
          d={letters[letter]}
          transform={`translate(${positions[index]} 0)`}
        />
      ))}
    </svg>
  );
}
