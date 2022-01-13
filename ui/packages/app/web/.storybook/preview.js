import 'tailwindcss/tailwind.css';
import './sb-tailwind.css';
import '../src/style/file-input.css';
import '../src/style/metrics.css';
import '../src/style/profile.css';
import '../src/style/sidenav.css';

export const parameters = {
  actions: {argTypesRegex: '^on[A-Z].*'},
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
};
