import { useRouter } from "next/router";
import Page from "./[[...route]].jsx";

export default function NotFound() {
  const { asPath } = useRouter();
  return <Page path={asPath?.startsWith("/ru/") ? "/ru/404" : "/404"} />;
}
