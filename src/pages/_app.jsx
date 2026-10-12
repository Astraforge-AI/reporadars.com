import "../styles.css";
import "../catalog-pages.css";
import "../account.css";
import "../editorial.css";
import "../locale.css";
import "../page-connections.css";
import "../collections.css";
import "../navigation.css";
import "../admin/admin.css";
import "../readability.css";

export default function Application({ Component, pageProps, router }) {
  return (
    <div id="root" key={router.asPath.split(/[?#]/)[0]}>
      <Component {...pageProps} />
    </div>
  );
}
