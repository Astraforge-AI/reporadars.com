// fetch(request) forwards to the configured origin without re-entering this Worker.
export default {
  async fetch(request) {
    return fetch(request);
  },
};
