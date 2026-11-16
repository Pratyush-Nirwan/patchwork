export default [
  {
    ignores: ["dist/**", ".astro/**", "node_modules/**"],
  },
  {
    files: ["**/*.{js,mjs,ts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../../*", "../../../../*", "../../../../../*"],
              message: "Imports must not escape the website/ package boundary.",
            },
          ],
        },
      ],
    },
  },
];
