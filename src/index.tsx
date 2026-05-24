/* @refresh reload */

import { For, lazy, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { themer, syncLibrary } from '@utils';
import NavBar from '@components/NavBar.tsx';
import { updateLang, setStore, store, navStore, playerStore, appMode, switchAppMode } from '@stores';
import './styles/global.css';
import './styles/mode-switch.css';


updateLang().then(() => {
  themer();
  render(() => <App />, document.body);
});


const MiniPlayer = lazy(() => import('@components/MiniPlayer'));
const ActionsMenu = lazy(() => import('@components/ActionsMenu'));
const SnackBar = lazy(() => import('@components/SnackBar'));

export default function App() {

  onMount(async () => {
    await import('@modules/start.ts').then(mod => mod.default());
    setStore('syncState', 'synced');
    syncLibrary('init');
  });

  return (
    <>
      {/* 頂部模式切換 Tab */}
      <div class="mode-switcher" id="modeSwitcher">
        <button
          class="mode-tab"
          classList={{ active: appMode() === 'music' }}
          onclick={() => switchAppMode('music')}
        >
          <i class="ri-music-2-fill"></i>
          <span>音樂</span>
        </button>
        <button
          class="mode-tab"
          classList={{ active: appMode() === 'video' }}
          onclick={() => switchAppMode('video')}
        >
          <i class="ri-movie-2-fill"></i>
          <span>影片</span>
        </button>
        <div
          class="mode-indicator"
          classList={{ video: appMode() === 'video' }}
        />
      </div>

      <main id="main" classList={{ 'mode-video': appMode() === 'video' }}>
        <For each={Object.values(navStore)}>
          {(item) =>
            <Show when={item.state}>
              <item.component />
            </Show>
          }
        </For>
      </main>
      <footer>
        <Show when={!navStore.player.state && playerStore.playbackState !== 'none'}>
          <MiniPlayer />
        </Show >
        <NavBar />
      </footer>
      <Show when={store.actionsMenu?.id}>
        <ActionsMenu />
      </Show>
      <Show when={store.snackbar}>
        <SnackBar />
      </Show>
    </>
  );
}
