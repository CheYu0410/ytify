import { Show } from "solid-js";
import { navStore, setNavStore, t, appMode } from "@stores";
import { setDrawer } from "@utils";

export default function() {
  const isVideo = () => appMode() === 'video';

  return (
    <nav class="navbar" classList={{ 'video-mode': isVideo() }}>
      {/* 音樂模式 nav */}
      <Show when={!isVideo()}>
        <i
          aria-label={t('nav_queue')}
          class="ri-order-play-fill"
          classList={{ on: navStore.queue.state }}
          onclick={() => {
            setNavStore('queue', 'state', !navStore.queue.state);
          }}
        ></i>

        <i
          aria-label={t('nav_search')}
          class={'ri-search-2-' + (navStore.search.state ? 'fill' : 'line')}
          classList={{
            'on': navStore.search.state
          }}
          onclick={() => {
            const state = !navStore.search.state;
            setNavStore('search', 'state', state);
            if (state) {
              setNavStore('library', 'state', false);
              navStore.search.ref?.scrollIntoView();
              setDrawer('lastMainFeature', 'search');
            }
          }}
        ></i>

        <i
          aria-label={t('nav_library')}
          class={'ri-archive-stack-' + (navStore.library.state ? 'fill' : 'line')}
          classList={{ 'on': navStore.library.state }}
          onclick={() => {
            const state = !navStore.library.state;
            setNavStore('library', 'state', state);
            if (state) {
              setNavStore('search', 'state', false);
              navStore.library.ref?.scrollIntoView();
              setDrawer('lastMainFeature', 'library');
            }
          }}
        ></i>
      </Show>

      {/* 影片模式 nav */}
      <Show when={isVideo()}>
        <i
          aria-label="影片搜尋"
          class={'ri-search-2-' + (navStore.search.state ? 'fill' : 'line')}
          classList={{ 'on': navStore.search.state }}
          onclick={() => {
            const state = !navStore.search.state;
            setNavStore('search', 'state', state);
            if (state) {
              navStore.search.ref?.scrollIntoView();
            }
          }}
        ></i>

        <i
          aria-label="稍後觀看"
          class={'ri-time-' + (navStore.queue.state ? 'fill' : 'line')}
          classList={{ 'on': navStore.queue.state }}
          onclick={() => {
            setNavStore('queue', 'state', !navStore.queue.state);
          }}
        ></i>
      </Show>
    </nav>
  );
}
