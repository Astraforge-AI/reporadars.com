import { Html, Head, Main, NextScript } from "next/document";

export default function Document(props) {
  const path = props.__NEXT_DATA__.props.pageProps.path || "/";
  const locale = path === "/ru" || path.startsWith("/ru/") ? "ru" : "en";
  return (
    <Html lang={locale}>
      <Head>
        <link rel="icon" href="/reporadars-assets/favicon.svg" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
