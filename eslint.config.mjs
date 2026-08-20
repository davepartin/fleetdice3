import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // This game deliberately mirrors live render state into refs so Three.js
    // callbacks never close over an old turn. The React compiler rules object
    // to that pattern even though it is the correct boundary for this canvas.
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "shots/**", ".simbuild/**", "_to_delete/**"]),
]);
