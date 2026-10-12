import { pagePaths } from "../data/skills.js";
export { default } from "../NextPage.jsx";

export function getStaticPaths() {
  return {
    paths: pagePaths
      .filter((path) => path !== "/404")
      .map((path) => ({
        params: { route: path === "/" ? [] : path.slice(1).split("/") },
      })),
    fallback: false,
  };
}

export function getStaticProps({ params }) {
  return { props: { path: `/${(params.route || []).join("/")}` } };
}

