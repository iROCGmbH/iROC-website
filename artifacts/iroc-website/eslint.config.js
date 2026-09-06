import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Custom AST selectors that flag raw `language === 'DE'` / `language === 'EN'`
 * (and their `!==` variants) used for user-visible text.
 *
 * Convention: use `t()` or `tJSX()` for any user-visible content.
 * Raw `language` comparisons are only valid for non-content logic such as
 * CSS active-state styling or analytics — in those spots add an eslint-disable
 * comment explaining why the direct comparison is correct.
 *
 * See: src/contexts/LanguageContext.tsx for the full convention doc.
 */
const LANG_SELECTORS = ['DE', 'EN'].flatMap((code) => [
  // language === 'DE'  /  language !== 'DE'
  `BinaryExpression[operator=/^={2,3}$|^!={1,2}$/][left.type='Identifier'][left.name='language'][right.type='Literal'][right.value='${code}']`,
  // 'DE' === language  /  'DE' !== language
  `BinaryExpression[operator=/^={2,3}$|^!={1,2}$/][left.type='Literal'][left.value='${code}'][right.type='Identifier'][right.name='language']`,
]);

const LANGUAGE_RESTRICTIONS = LANG_SELECTORS.map((selector) => ({
  selector,
  message:
    "Use t() or tJSX() for user-visible text instead of comparing language directly. " +
    "Reserve raw language comparisons for non-content logic (styling, analytics) and " +
    "annotate those with an eslint-disable comment explaining why they are correct.",
}));

const LAZY_ROUTE_SELECTOR = {
  // Route components must be React.lazy() references so adding a page cannot
  // accidentally make it part of the initial bundle. Checking the whole value
  // shape catches direct imports, aliases, and namespace members alike.
  selector:
    "Property[key.name='component']:not([value.type='CallExpression'][value.callee.type='Identifier'][value.callee.name='lazy']):not([value.type='CallExpression'][value.callee.type='MemberExpression'][value.callee.object.name='React'][value.callee.property.name='lazy'])",
  message:
    'Route components in navLinks.ts must be wrapped in React.lazy(() => import(...)).',
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // Catch inline language comparisons used for user-visible text.
      // Use t() or tJSX() instead — see LanguageContext.tsx for the convention.
      'no-restricted-syntax': [
        'error',
        ...LANGUAGE_RESTRICTIONS,
      ],
    },
  },
  {
    // Route components are intentionally lazy-loaded. Keep this check scoped
    // to the page registry so ordinary component composition can use imports.
    files: ['src/config/navLinks.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...LANGUAGE_RESTRICTIONS,
        LAZY_ROUTE_SELECTOR,
      ],
    },
  },
  {
    // LanguageContext is the one file allowed to compare language directly
    // because it IS the implementation of t() and tJSX().
    files: ['src/contexts/LanguageContext.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Test-only language comparisons drive the LanguageProvider test fixture;
    // they do not render user-facing content.
    files: ['src/test/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
