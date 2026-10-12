import "../../src/styles.css";
import "../../src/catalog-pages.css";
import "../../src/account.css";
import "../../src/editorial.css";
import "../../src/locale.css";
import "../../src/page-connections.css";
import "../../src/collections.css";
import "../../src/navigation.css";
import "../../src/admin/admin.css";
import "../../src/readability.css";

export default function Application({ Component, pageProps, router }) {
  return (
    <div id="root" key={router.asPath.split(/[?#]/)[0]}>
      <Component {...pageProps} />
    </div>
  );
}
