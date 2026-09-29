/* =========================================================
   LASTMUSIC
   PREMIUM LOCAL-FIRST MUSIC PLAYER
   ========================================================= */

"use strict";


/* =========================================================
   CONFIG
   ========================================================= */

const DB_NAME = "LastMusicDB";
const DB_VERSION = 2;

const STORE_TRACKS = "tracks";
const STORE_SETTINGS = "settings";

const DEFAULT_ART =
  createDefaultArtwork();

let db = null;

let tracks = [];

let currentTrackId = null;

let queue = [];

let queueIndex = -1;

let isPlaying = false;

let shuffleEnabled = false;

let repeatMode = "off";
// off | all | one

let sleepTimer = null;

let sleepTimeout = null;

let currentContextTrackId = null;

let currentEditTrackId = null;

let currentSearchFilter = "all";

let currentObjectUrl = null;

let toastTimer = null;


/* =========================================================
   DOM
   ========================================================= */

const $ = id => document.getElementById(id);

const audio = $("audio");

const miniPlayer = $("miniPlayer");

const nowPlaying = $("nowPlaying");


/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {

  await initDB();

  await loadLibrary();

  bindEvents();

  renderEverything();

  restorePlaybackState();

});


/* =========================================================
   DATABASE
   ========================================================= */

function initDB() {

  return new Promise((resolve, reject) => {

    const request =
      indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {

      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_TRACKS)) {

        const store =
          database.createObjectStore(
            STORE_TRACKS,
            { keyPath: "id" }
          );

        store.createIndex(
          "title",
          "title",
          { unique: false }
        );

        store.createIndex(
          "artist",
          "artist",
          { unique: false }
        );

        store.createIndex(
          "album",
          "album",
          { unique: false }
        );

      }

      if (!database.objectStoreNames.contains(STORE_SETTINGS)) {

        database.createObjectStore(
          STORE_SETTINGS,
          { keyPath: "key" }
        );

      }

    };

    request.onsuccess = () => {

      db = request.result;

      resolve();

    };

    request.onerror = () => {

      reject(request.error);

    };

  });

}


function dbPut(storeName, value) {

  return new Promise((resolve, reject) => {

    const transaction =
      db.transaction(
        storeName,
        "readwrite"
      );

    const store =
      transaction.objectStore(storeName);

    const request =
      store.put(value);

    request.onsuccess = () =>
      resolve();

    request.onerror = () =>
      reject(request.error);

  });

}


function dbGetAll(storeName) {

  return new Promise((resolve, reject) => {

    const transaction =
      db.transaction(
        storeName,
        "readonly"
      );

    const request =
      transaction
        .objectStore(storeName)
        .getAll();

    request.onsuccess = () =>
      resolve(request.result || []);

    request.onerror = () =>
      reject(request.error);

  });

}


function dbDelete(storeName, id) {

  return new Promise((resolve, reject) => {

    const transaction =
      db.transaction(
        storeName,
        "readwrite"
      );

    const request =
      transaction
        .objectStore(storeName)
        .delete(id);

    request.onsuccess = () =>
      resolve();

    request.onerror = () =>
      reject(request.error);

  });

}


function dbGet(storeName, id) {

  return new Promise((resolve, reject) => {

    const transaction =
      db.transaction(
        storeName,
        "readonly"
      );

    const request =
      transaction
        .objectStore(storeName)
        .get(id);

    request.onsuccess = () =>
      resolve(request.result);

    request.onerror = () =>
      reject(request.error);

  });

}


/* =========================================================
   CLOUD CATALOG SYNC
   ========================================================= */

async function fetchCloudTracks() {
  if (Array.isArray(window.CLOUD_SONGS)) {
    return window.CLOUD_SONGS;
  }
  return [];
}


/* =========================================================
   LIBRARY
   ========================================================= */

async function loadLibrary() {

  const localTracks =
    await dbGetAll(STORE_TRACKS);

  const cloudTracks =
    await fetchCloudTracks();

  const existingIds =
    new Set(
      localTracks.map(t => t.id)
    );

  const newCloudTracks =
    cloudTracks.filter(
      t => !existingIds.has(t.id)
    );

  tracks =
    [...localTracks, ...newCloudTracks];

  tracks.sort(
    (a, b) =>
      (a.title || "").localeCompare(
        b.title || ""
      )
  );

}



async function saveTrack(track) {

  await dbPut(
    STORE_TRACKS,
    track
  );

}


async function saveSettings() {

  await dbPut(
    STORE_SETTINGS,
    {
      key: "playback",
      currentTrackId,
      queue,
      queueIndex,
      shuffleEnabled,
      repeatMode,
      position:
        currentTrackId
          ? audio.currentTime || 0
          : 0
    }
  );

}


/* =========================================================
   EVENTS
   ========================================================= */

function bindEvents() {

  /* Navigation */

  document
    .querySelectorAll(".nav-item[data-page]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          showPage(
            button.dataset.page
          );

        }
      );

    });

     /* Click outside bottom-sheet to close */
  document.addEventListener("click", event => {
    const openSheet = document.querySelector(".bottom-sheet.open");
    if (!openSheet) return;

    // If click is not inside the open sheet, and not on a button that opens a sheet
    if (
      !openSheet.contains(event.target) &&
      !event.target.closest("[data-more-track]") &&
      !event.target.closest("#npMore") &&
      !event.target.closest("#queueBtn") &&
      !event.target.closest("#settingsBtn") &&
      !event.target.closest("#createNavBtn") &&
      !event.target.closest("#libraryAddBtn")
    ) {
      closeAllSheets();
    }
  });

  /* Swipe down on sheet handle to close */
  document.querySelectorAll(".bottom-sheet").forEach(sheet => {
    let startY = 0;

    sheet.addEventListener("touchstart", e => {
      startY = e.touches[0].clientY;
    }, { passive: true });

    sheet.addEventListener("touchend", e => {
      const endY = e.changedTouches[0].clientY;
      if (endY - startY > 60) {
        closeAllSheets();
      }
    }, { passive: true });
  });

  /* Add buttons */

  $("createNavBtn")
    .addEventListener(
      "click",
      openSourceSheet
    );

  $("libraryAddBtn")
    .addEventListener(
      "click",
      openSourceSheet
    );

  $("importHomeBtn")
    .addEventListener(
      "click",
      () => {

        closeAllSheets();

        $("fileInput").click();

      }
    );


  $("sourceFiles")
    .addEventListener(
      "click",
      () => {

        closeAllSheets();

        $("fileInput").click();

      }
    );


  $("sourceFolder")
    .addEventListener(
      "click",
      () => {

        closeAllSheets();

        $("folderInput").click();

      }
    );


  $("fileInput")
    .addEventListener(
      "change",
      event => {

        importFiles(
          [...event.target.files]
        );

        event.target.value = "";

      }
    );


  $("folderInput")
    .addEventListener(
      "change",
      event => {

        importFiles(
          [...event.target.files]
        );

        event.target.value = "";

      }
    );


  /* Player */

  $("miniMain")
    .addEventListener(
      "click",
      openNowPlaying
    );

  $("openNowPlayingNav")
    .addEventListener(
      "click",
      openNowPlaying
    );

  $("miniPlay")
    .addEventListener(
      "click",
      event => {

        event.stopPropagation();

        togglePlay();

      }
    );

  $("miniNext")
    .addEventListener(
      "click",
      event => {

        event.stopPropagation();

        nextTrack();

      }
    );

  $("miniFavorite")
    .addEventListener(
      "click",
      event => {

        event.stopPropagation();

        toggleCurrentFavorite();

      }
    );


  $("closeNowPlaying")
    .addEventListener(
      "click",
      closeNowPlaying
    );

  $("playBtn")
    .addEventListener(
      "click",
      togglePlay
    );

  $("previousBtn")
    .addEventListener(
      "click",
      previousTrack
    );

  $("nextBtn")
    .addEventListener(
      "click",
      nextTrack
    );

  $("shuffleBtn")
    .addEventListener(
      "click",
      toggleShuffle
    );

  $("repeatBtn")
    .addEventListener(
      "click",
      cycleRepeat
    );

  $("npFavorite")
    .addEventListener(
      "click",
      toggleCurrentFavorite
    );

  $("seekBar")
    .addEventListener(
      "input",
      seekAudio
    );


  audio.addEventListener(
    "timeupdate",
    updateProgress
  );

  audio.addEventListener(
    "loadedmetadata",
    updateDuration
  );

  audio.addEventListener(
    "play",
    () => {

      isPlaying = true;

      updatePlayerUI();

    }
  );

  audio.addEventListener(
    "pause",
    () => {

      isPlaying = false;

      updatePlayerUI();

    }
  );

  audio.addEventListener(
    "ended",
    handleEnded
  );

  audio.addEventListener(
    "error",
    handleAudioError
  );


  /* Utility */

  $("sleepBtn")
    .addEventListener(
      "click",
      () => openModal("sleepModal")
    );

  $("lyricsBtn")
    .addEventListener(
      "click",
      () => {

        showToast(
          "Lyrics are not embedded for this track."
        );

      }
    );

  $("queueBtn")
    .addEventListener(
      "click",
      openQueue
    );

  $("npMore")
    .addEventListener(
      "click",
      () => {

        if (currentTrackId) {

          openContextSheet(
            currentTrackId
          );

        }

      }
    );


  /* Settings & Premium Clear Confirmation */

  $("settingsBtn")
    .addEventListener(
      "click",
      showSettings
    );

  $("clearLibraryBtn")
    .addEventListener(
      "click",
      () => {

        closeAllSheets();

        openModal("clearConfirmModal");

      }
    );

  $("executeClearBtn")
    .addEventListener(
      "click",
      async () => {

        const tx =
          db.transaction(
            [STORE_TRACKS, STORE_SETTINGS],
            "readwrite"
          );

        tx.objectStore(STORE_TRACKS).clear();
        tx.objectStore(STORE_SETTINGS).clear();

        tx.oncomplete = () => {

          location.reload();

        };

      }
    );


  /* Edit */

  $("saveEditBtn")
    .addEventListener(
      "click",
      saveEditedTrack
    );

  $("artInput")
    .addEventListener(
      "change",
      previewArtwork
    );


  /* Sleep */

  document
    .querySelectorAll("[data-sleep]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          setSleepTimer(
            Number(button.dataset.sleep)
          );

          closeModal("sleepModal");

        }
      );

    });


  $("cancelSleep")
    .addEventListener(
      "click",
      cancelSleepTimer
    );


  /* Search */

  $("searchInput")
    .addEventListener(
      "input",
      renderSearch
    );

  $("clearSearch")
    .addEventListener(
      "click",
      () => {

        $("searchInput").value = "";

        renderSearch();

      }
    );

  document
    .querySelectorAll("[data-search-filter]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          currentSearchFilter =
            button.dataset.searchFilter;

          document
            .querySelectorAll("[data-search-filter]")
            .forEach(
              item =>
                item.classList.toggle(
                  "active",
                  item === button
                )
            );

          renderSearch();

        }
      );

    });


  /* Library tabs */

  document
    .querySelectorAll("[data-library-tab]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll("[data-library-tab]")
            .forEach(
              item =>
                item.classList.toggle(
                  "active",
                  item === button
                )
            );

          renderLibraryTab(
            button.dataset.libraryTab
          );

        }
      );

    });


  /* Generic actions */

  document
    .querySelectorAll("[data-action]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          handleQuickAction(
            button.dataset.action
          );

        }
      );

    });


  /* Context */

  document
    .querySelectorAll("[data-context]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          handleContextAction(
            button.dataset.context
          );

        }
      );

    });


  /* Close */

  document
    .querySelectorAll("[data-close-sheet]")
    .forEach(button => {

      button.addEventListener(
        "click",
        closeAllSheets
      );

    });

  document
    .querySelectorAll("[data-close-modal]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          closeAllModals();

        }
      );

    });


  /* Close backdrop */

  document
    .querySelectorAll(".modal-backdrop")
    .forEach(backdrop => {

      backdrop.addEventListener(
        "click",
        event => {

          if (event.target === backdrop) {

            backdrop.classList.remove("open");

          }

        }
      );

    });


  /* Keyboard */

  document.addEventListener(
    "keydown",
    event => {

      if (event.code === "Space") {

        const tag =
          document.activeElement?.tagName;

        if (
          tag !== "INPUT" &&
          tag !== "TEXTAREA"
        ) {

          event.preventDefault();

          togglePlay();

        }

      }

      if (event.code === "ArrowRight") {

        if (currentTrackId) {

          audio.currentTime =
            Math.min(
              audio.duration || 0,
              audio.currentTime + 5
            );

        }

      }

      if (event.code === "ArrowLeft") {

        if (currentTrackId) {

          audio.currentTime =
            Math.max(
              0,
              audio.currentTime - 5
            );

        }

      }

    }
  );


  /* Media Session */

  if ("mediaSession" in navigator) {

    navigator.mediaSession.setActionHandler(
      "play",
      () => audio.play()
    );

    navigator.mediaSession.setActionHandler(
      "pause",
      () => audio.pause()
    );

    navigator.mediaSession.setActionHandler(
      "previoustrack",
      previousTrack
    );

    navigator.mediaSession.setActionHandler(
      "nexttrack",
      nextTrack
    );

    navigator.mediaSession.setActionHandler(
      "seekbackward",
      () => {

        audio.currentTime =
          Math.max(
            0,
            audio.currentTime - 10
          );

      }
    );

    navigator.mediaSession.setActionHandler(
      "seekforward",
      () => {

        audio.currentTime =
          Math.min(
            audio.duration || 0,
            audio.currentTime + 10
          );

      }
    );

  }

}


/* =========================================================
   IMPORT LOCAL FILES
   ========================================================= */

async function importFiles(files) {

  const audioFiles =
    files.filter(
      file =>
        file.type.startsWith("audio/") ||
        /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i
          .test(file.name)
    );

  if (!audioFiles.length) {

    showToast("No audio files found.");

    return;

  }

  showToast(
    `Importing ${audioFiles.length} song${audioFiles.length === 1 ? "" : "s"}...`
  );

  let imported = 0;

  for (const file of audioFiles) {

    try {

      const metadata =
        await readMetadata(file);

      const track = {

        id:
          "local_" +
          crypto.randomUUID(),

        sourceType:
          "local",

        blob:
          file,

        title:
          metadata.title ||
          cleanFileName(file.name),

        artist:
          metadata.artist ||
          "Unknown artist",

        album:
          metadata.album ||
          "Unknown album",

        artwork:
          metadata.artwork || null,

        artworkUrl:
          null,

        filename:
          file.name,

        duration:
          0,

        favorite:
          false,

        playCount:
          0,

        lastPlayed:
          0,

        createdAt:
          Date.now()

      };

      await saveTrack(track);

      tracks.push(track);

      imported++;

    } catch (error) {

      console.error(
        "Import error:",
        error
      );

    }

  }

  tracks.sort(
    (a, b) =>
      (a.title || "").localeCompare(
        b.title || ""
      )
  );

  renderEverything();

  showToast(
    `${imported} song${imported === 1 ? "" : "s"} added`
  );

}


/* =========================================================
   METADATA
   ========================================================= */

function readMetadata(file) {

  return new Promise(resolve => {

    if (
      typeof jsmediatags === "undefined"
    ) {

      resolve({});

      return;

    }

    try {

      jsmediatags.read(
        file,
        {

          onSuccess:
            tagData => {

              const tags =
                tagData.tags || {};

              let artwork = null;

              if (
                tags.picture &&
                Array.isArray(
                  tags.picture.data
                )
              ) {

                const picture =
                  tags.picture;

                const byteArray =
                  new Uint8Array(
                    picture.data
                  );

                artwork =
                  new Blob(
                    [byteArray],
                    {
                      type:
                        picture.format ||
                        "image/jpeg"
                    }
                  );

              }

              resolve({

                title:
                  tags.title || "",

                artist:
                  tags.artist || "",

                album:
                  tags.album || "",

                artwork

              });

            },

          onError:
            () => resolve({})

        }
      );

    } catch {

      resolve({});

    }

  });

}


function cleanFileName(name) {

  return name
    .replace(
      /\.[^/.]+$/,
      ""
    )
    .replace(
      /[_-]+/g,
      " "
    )
    .trim();

}


/* =========================================================
   PLAYBACK
   ========================================================= */

async function playTrack(
  trackId,
  addToHistory = true
) {

  const track =
    tracks.find(
      item =>
        item.id === trackId
    );

  if (!track) {

    showToast("Song not found.");

    return;

  }

  currentTrackId =
    track.id;

  if (
    currentObjectUrl
  ) {

    URL.revokeObjectURL(
      currentObjectUrl
    );

    currentObjectUrl =
      null;

  }

  if (
    track.sourceType === "local"
  ) {

    if (!track.blob) {

      showToast(
        "This local file is no longer available."
      );

      return;

    }

    currentObjectUrl =
      URL.createObjectURL(
        track.blob
      );

    audio.src =
      currentObjectUrl;

  } else {

    audio.src =
      track.url;

  }

  updatePlayerUI();

  try {

    await audio.play();

  } catch (error) {

    console.warn(
      "Playback failed:",
      error
    );

    isPlaying =
      false;

    updatePlayerUI();

    showToast(
      "This song could not be played."
    );

    return;

  }

  if (addToHistory) {

    track.playCount =
      (track.playCount || 0) + 1;

    track.lastPlayed =
      Date.now();

    if (track.sourceType === "local") {

      await saveTrack(track);

    }

  }

  updateMediaSession(track);

  await saveSettings();

  renderRecent();

}


function togglePlay() {

  if (!currentTrackId) {

    const first =
      tracks[0];

    if (first) {

      playTrack(
        first.id
      );

    } else {

      showToast(
        "Add some music first."
      );

    }

    return;

  }

  if (audio.paused) {

    audio.play().catch(
      () => {}
    );

  } else {

    audio.pause();

  }

}


function previousTrack() {

  if (!currentTrackId) return;

  if (
    audio.currentTime > 4
  ) {

    audio.currentTime = 0;

    return;

  }

  if (
    queue.length &&
    queueIndex > 0
  ) {

    queueIndex--;

    playTrack(
      queue[queueIndex]
    );

    return;

  }

  const index =
    tracks.findIndex(
      track =>
        track.id ===
        currentTrackId
    );

  const previous =
    tracks[
      index <= 0
        ? tracks.length - 1
        : index - 1
    ];

  if (previous) {

    playTrack(
      previous.id
    );

  }

}


function nextTrack() {

  if (!currentTrackId) return;

  if (
    repeatMode === "one"
  ) {

    audio.currentTime = 0;

    audio.play().catch(
      () => {}
    );

    return;

  }

  if (
    queue.length &&
    queueIndex < queue.length - 1
  ) {

    queueIndex++;

    playTrack(
      queue[queueIndex]
    );

    return;

  }

  if (
    shuffleEnabled
  ) {

    const available =
      tracks.filter(
        track =>
          track.id !==
          currentTrackId
      );

    if (!available.length) {

      if (
        repeatMode === "all"
      ) {

        playTrack(
          currentTrackId
        );

      }

      return;

    }

    const next =
      available[
        Math.floor(
          Math.random() *
          available.length
        )
      ];

    playTrack(
      next.id
    );

    return;

  }

  const index =
    tracks.findIndex(
      track =>
        track.id ===
        currentTrackId
    );

  let nextIndex =
    index + 1;

  if (
    nextIndex >=
    tracks.length
  ) {

    if (
      repeatMode === "all"
    ) {

      nextIndex = 0;

    } else {

      return;

    }

  }

  const next =
    tracks[nextIndex];

  if (next) {

    playTrack(
      next.id
    );

  }

}


function handleEnded() {

  if (
    repeatMode === "one"
  ) {

    audio.currentTime = 0;

    audio.play().catch(
      () => {}
    );

    return;

  }

  nextTrack();

}


/* =========================================================
   PROGRESS
   ========================================================= */

function updateProgress() {

  const duration =
    audio.duration || 0;

  const current =
    audio.currentTime || 0;

  const percent =
    duration
      ? current / duration * 100
      : 0;

  $("seekBar").value =
    percent;

  $("seekBar").style.background =
    `
      linear-gradient(
        90deg,
        #789bff 0%,
        #789bff ${percent}%,
        rgba(255,255,255,.09) ${percent}%,
        rgba(255,255,255,.09) 100%
      )
    `;

  $("currentTime").textContent =
    formatTime(current);

  $("miniProgress").style.width =
    percent + "%";

  if (
    Math.floor(current) % 5 === 0
  ) {

    saveSettings();

  }

}


function updateDuration() {

  $("duration").textContent =
    formatTime(
      audio.duration
    );

}


function seekAudio() {

  if (!audio.duration) return;

  const percent =
    Number(
      $("seekBar").value
    );

  audio.currentTime =
    audio.duration *
    (percent / 100);

}


function formatTime(seconds) {

  if (
    !Number.isFinite(seconds)
  ) {

    return "0:00";

  }

  const mins =
    Math.floor(
      seconds / 60
    );

  const secs =
    Math.floor(
      seconds % 60
    )
      .toString()
      .padStart(2, "0");

  return `${mins}:${secs}`;

}


/* =========================================================
   PLAYER UI
   ========================================================= */

function updatePlayerUI() {

  const track =
    tracks.find(
      item =>
        item.id ===
        currentTrackId
    );

  if (!track) {

    miniPlayer.classList.add(
      "hidden"
    );

    return;

  }

  miniPlayer.classList.remove(
    "hidden"
  );

  const art =
    getArtworkUrl(track);

  $("miniArt").src =
    art;

  $("npArt").src =
    art;

  $("miniTitle").textContent =
    track.title;

  $("miniArtist").textContent =
    track.artist;

  $("npTitle").textContent =
    track.title;

  $("npArtist").textContent =
    `${track.artist} • ${track.album}`;

  const favorite =
    !!track.favorite;

  $("miniFavorite").textContent =
    favorite
      ? "♥"
      : "♡";

  $("npFavorite").textContent =
    favorite
      ? "♥"
      : "♡";

  $("npFavorite").classList.toggle(
    "active",
    favorite
  );

  $("playBtn").textContent =
    isPlaying
      ? "Ⅱ"
      : "▶";

  $("miniPlay").textContent =
    isPlaying
      ? "Ⅱ"
      : "▶";

  $("shuffleBtn").classList.toggle(
    "active",
    shuffleEnabled
  );

  $("repeatBtn").classList.toggle(
    "active",
    repeatMode !== "off"
  );

  $("repeatBtn").textContent =
    repeatMode === "one"
      ? "↻¹"
      : "↻";

  $("visualizer").classList.toggle(
    "paused",
    !isPlaying
  );

  $("npArtShell").classList.toggle(
    "rotating",
    isPlaying
  );

  miniPlayer.classList.toggle(
    "playing",
    isPlaying
  );

  updateDynamicAccent(
    track
  );

}


function getArtworkUrl(track) {

  if (track.artworkUrl) {

    return track.artworkUrl;

  }

  if (track.artwork) {

    return URL.createObjectURL(
      track.artwork
    );

  }

  return DEFAULT_ART;

}


function updateDynamicAccent(track) {

  if (!track.artwork && !track.artworkUrl) {

    document.documentElement
      .style
      .setProperty(
        "--accent-rgb",
        "93,140,255"
      );

    return;

  }

  const image =
    new Image();

  image.crossOrigin = "anonymous";

  let cleanupUrl = null;

  let url;

  if (track.artworkUrl) {

    url = track.artworkUrl;

  } else {

    url = URL.createObjectURL(track.artwork);

    cleanupUrl = url;

  }

  image.onload = () => {

    try {

      const canvas =
        document.createElement("canvas");

      canvas.width = 1;
      canvas.height = 1;

      const context =
        canvas.getContext("2d");

      context.drawImage(image, 0, 0, 1, 1);

      const data =
        context.getImageData(0, 0, 1, 1).data;

      document.documentElement
        .style
        .setProperty(
          "--accent-rgb",
          `${data[0]},${data[1]},${data[2]}`
        );

    } catch {}

    if (cleanupUrl) {

      URL.revokeObjectURL(cleanupUrl);

    }

  };

  image.onerror = () => {

    if (cleanupUrl) {

      URL.revokeObjectURL(cleanupUrl);

    }

  };

  image.src = url;

}


/* =========================================================
   NOW PLAYING
   ========================================================= */

function openNowPlaying() {

  if (!currentTrackId) {

    if (tracks.length) {

      playTrack(
        tracks[0].id
      );

    } else {

      showToast(
        "Add music first."
      );

    }

    return;

  }

  nowPlaying.classList.add(
    "open"
  );

  updatePlayerUI();

}


function closeNowPlaying() {

  nowPlaying.classList.remove(
    "open"
  );

}


/* =========================================================
   FAVORITES
   ========================================================= */

async function toggleCurrentFavorite() {

  if (!currentTrackId) return;

  await toggleFavorite(
    currentTrackId
  );

}


async function toggleFavorite(id) {

  const track =
    tracks.find(
      item =>
        item.id === id
    );

  if (!track) return;

  track.favorite =
    !track.favorite;

  if (track.sourceType === "local") {

    await saveTrack(track);

  }

  updatePlayerUI();

  renderEverything();

  showToast(
    track.favorite
      ? "Added to favorites"
      : "Removed from favorites"
  );

}


/* =========================================================
   SHUFFLE / REPEAT
   ========================================================= */

function toggleShuffle() {

  shuffleEnabled =
    !shuffleEnabled;

  updatePlayerUI();

  saveSettings();

  showToast(
    shuffleEnabled
      ? "Shuffle on"
      : "Shuffle off"
  );

}


function cycleRepeat() {

  if (repeatMode === "off") {

    repeatMode = "all";

  } else if (
    repeatMode === "all"
  ) {

    repeatMode = "one";

  } else {

    repeatMode = "off";

  }

  updatePlayerUI();

  saveSettings();

  const labels = {
    off: "Repeat off",
    all: "Repeat all",
    one: "Repeat song"
  };

  showToast(
    labels[repeatMode]
  );

}


/* =========================================================
   QUEUE
   ========================================================= */

function addToQueue(id) {

  if (
    !queue.includes(id)
  ) {

    queue.push(id);

  }

  queueIndex =
    queue.indexOf(
      currentTrackId
    );

  saveSettings();

  showToast(
    "Added to queue"
  );

}


function openQueue() {

  renderQueue();

  openSheet(
    "queueSheet"
  );

}


function renderQueue() {

  const container =
    $("queueContent");

  if (!queue.length) {

    container.innerHTML = `
      <div class="empty-small">
        <span>☷</span>
        <p>Your queue is empty.</p>
      </div>
    `;

    return;

  }

  container.innerHTML =
    queue
      .map(
        (id, index) => {

          const track =
            tracks.find(
              item =>
                item.id === id
            );

          if (!track) return "";

          return `
            <div
              class="queue-item ${
                id === currentTrackId
                  ? "current"
                  : ""
              }"
            >

              <img
                src="${getArtworkUrl(track)}"
                alt=""
              >

              <div class="queue-item-info">

                <strong>
                  ${escapeHTML(track.title)}
                </strong>

                <span>
                  ${escapeHTML(track.artist)}
                </span>

              </div>

              <button
                class="queue-remove"
                data-remove-queue="${index}"
              >
                ×
              </button>

            </div>
          `;

        }
      )
      .join("");

  container
    .querySelectorAll(
      "[data-remove-queue]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          queue.splice(
            Number(
              button.dataset.removeQueue
            ),
            1
          );

          renderQueue();

          saveSettings();

        }
      );

    });

}


/* =========================================================
   CONTEXT MENU
   ========================================================= */

function openContextSheet(id) {

  const track =
    tracks.find(
      item =>
        item.id === id
    );

  if (!track) return;

  currentContextTrackId =
    id;

  $("contextArt").src =
    getArtworkUrl(track);

  $("contextTitle").textContent =
    track.title;

  $("contextArtist").textContent =
    track.artist;

  openSheet(
    "contextSheet"
  );

}


async function handleContextAction(action) {

  const id =
    currentContextTrackId;

  const track =
    tracks.find(
      item =>
        item.id === id
    );

  closeAllSheets();

  if (!track) return;

  switch (action) {

    case "play":

      playTrack(id);

      break;

    case "queue":

      addToQueue(id);

      break;

    case "favorite":

      toggleFavorite(id);

      break;

    case "edit":

      openEditModal(id);

      break;

    case "share":

      shareTrack(track);

      break;

    case "delete":

      deleteTrack(id);

      break;

  }

}


/* =========================================================
   EDIT
   ========================================================= */

function openEditModal(id) {

  const track =
    tracks.find(
      item =>
        item.id === id
    );

  if (!track) return;

  currentEditTrackId =
    id;

  $("editTitle").value =
    track.title || "";

  $("editArtist").value =
    track.artist || "";

  $("editAlbum").value =
    track.album || "";

  $("editArtPreview").src =
    getArtworkUrl(track);

  openModal(
    "editModal"
  );

}


let pendingArtwork = null;


function previewArtwork(event) {

  const file =
    event.target.files?.[0];

  if (!file) return;

  pendingArtwork =
    file;

  $("editArtPreview").src =
    URL.createObjectURL(
      file
    );

}


async function saveEditedTrack() {

  const track =
    tracks.find(
      item =>
        item.id ===
        currentEditTrackId
    );

  if (!track) return;

  track.title =
    $("editTitle").value.trim() ||
    "Untitled";

  track.artist =
    $("editArtist").value.trim() ||
    "Unknown artist";

  track.album =
    $("editAlbum").value.trim() ||
    "Unknown album";

  if (pendingArtwork) {

    track.artwork =
      pendingArtwork;

    track.artworkUrl =
      null;

  }

  await saveTrack(track);

  pendingArtwork =
    null;

  closeAllModals();

  renderEverything();

  updatePlayerUI();

  showToast(
    "Song updated"
  );

}


/* =========================================================
   DELETE
   ========================================================= */

async function deleteTrack(id) {

  const track =
    tracks.find(
      item =>
        item.id === id
    );

  if (!track) return;

  if (track.sourceType === "cloud") {

    showToast("Cloud tracks are managed in your songs.json file.");

    return;

  }

  await dbDelete(
    STORE_TRACKS,
    id
  );

  tracks =
    tracks.filter(
      item =>
        item.id !== id
    );

  queue =
    queue.filter(
      item =>
        item !== id
    );

  if (
    currentTrackId === id
  ) {

    audio.pause();

    audio.removeAttribute(
      "src"
    );

    audio.load();

    currentTrackId =
      null;

    isPlaying =
      false;

    if (currentObjectUrl) {

      URL.revokeObjectURL(
        currentObjectUrl
      );

      currentObjectUrl =
        null;

    }

  }

  await saveSettings();

  renderEverything();

  updatePlayerUI();

  showToast(
    "Removed from library"
  );

}


/* =========================================================
   SHARE
   ========================================================= */

async function shareTrack(track) {

  const text =
    `${track.title} — ${track.artist}`;

  if (
    navigator.share
  ) {

    try {

      await navigator.share({
        title:
          track.title,
        text
      });

      return;

    } catch {}

  }

  try {

    await navigator.clipboard.writeText(
      text
    );

    showToast(
      "Song info copied"
    );

  } catch {

    showToast(
      text
    );

  }

}


/* =========================================================
   SEARCH
   ========================================================= */

function renderSearch() {

  const query =
    $("searchInput")
      .value
      .trim()
      .toLowerCase();

  $("clearSearch").style.display =
    query
      ? "block"
      : "none";

  let results =
    tracks.filter(
      track => {

        if (!query) return true;

        const haystack =
          [
            track.title,
            track.artist,
            track.album
          ]
            .join(" ")
            .toLowerCase();

        return haystack.includes(
          query
        );

      }
    );

  if (
    currentSearchFilter ===
    "songs"
  ) {

    results =
      results.filter(
        track =>
          track.title
      );

  }

  if (
    currentSearchFilter ===
    "albums"
  ) {

    results =
      uniqueAlbums(results)
        .map(
          album =>
            tracks.find(
              track =>
                track.album === album
            )
        );

  }

  if (
    currentSearchFilter ===
    "artists"
  ) {

    results =
      uniqueArtists(results)
        .map(
          artist =>
            tracks.find(
              track =>
                track.artist === artist
            )
        );

  }

  const container =
    $("searchResults");

  if (!results.length) {

    container.innerHTML = `
      <div class="empty-small">
        <span>⌕</span>
        <p>
          ${
            query
              ? "No matching music found."
              : "Your library is waiting for music."
          }
        </p>
      </div>
    `;

    return;

  }

  container.innerHTML =
    results
      .map(
        track =>
          track
            ? trackHTML(track)
            : ""
      )
      .join("");

  attachTrackEvents(
    container
  );

}


/* =========================================================
   LIBRARY
   ========================================================= */

function renderLibraryTab(tab) {

  const container =
    $("libraryContent");

  if (tab === "songs") {

    renderSongs(container);

  } else if (
    tab === "albums"
  ) {

    renderAlbums(container);

  } else if (
    tab === "artists"
  ) {

    renderArtists(container);

  } else if (
    tab === "playlists"
  ) {

    renderPlaylists(container);

  }

}


function renderSongs(container) {

  if (!tracks.length) {

    container.innerHTML =
      libraryEmptyHTML();

    return;

  }

  container.innerHTML =
    `<div class="track-list">
      ${
        tracks
          .map(trackHTML)
          .join("")
      }
    </div>`;

  attachTrackEvents(
    container
  );

}


function renderAlbums(container) {

  const albums =
    uniqueAlbums(
      tracks
    );

  if (!albums.length) {

    container.innerHTML =
      libraryEmptyHTML();

    return;

  }

  container.innerHTML =
    `
      <div class="library-grid">
        ${
          albums
            .map(
              album => {

                const track =
                  tracks.find(
                    item =>
                      item.album ===
                      album
                  );

                const count =
                  tracks.filter(
                    item =>
                      item.album ===
                      album
                  ).length;

                return `
                  <button
                    class="library-album"
                    data-album="${escapeAttr(album)}"
                  >

                    <img
                      src="${getArtworkUrl(track)}"
                      alt=""
                    >

                    <strong>
                      ${escapeHTML(album)}
                    </strong>

                    <span>
                      ${count} song${count === 1 ? "" : "s"}
                    </span>

                  </button>
                `;

              }
            )
            .join("")
        }
      </div>
    `;

  container
    .querySelectorAll(
      "[data-album]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const album =
            button.dataset.album;

          const albumTracks =
            tracks.filter(
              track =>
                track.album ===
                album
            );

          if (albumTracks.length) {

            playTrack(
              albumTracks[0].id
            );

          }

        }
      );

    });

}


function renderArtists(container) {

  const artists =
    uniqueArtists(
      tracks
    );

  if (!artists.length) {

    container.innerHTML =
      libraryEmptyHTML();

    return;

  }

  container.innerHTML =
    `
      <div class="track-list">
        ${
          artists
            .map(
              artist => {

                const track =
                  tracks.find(
                    item =>
                      item.artist ===
                      artist
                  );

                const count =
                  tracks.filter(
                    item =>
                      item.artist ===
                      artist
                  ).length;

                return `
                  <button
                    class="artist-list-item"
                    data-artist="${escapeAttr(artist)}"
                  >

                    <img
                      src="${getArtworkUrl(track)}"
                      alt=""
                    >

                    <div>

                      <strong>
                        ${escapeHTML(artist)}
                      </strong>

                      <span>
                        ${count} song${count === 1 ? "" : "s"}
                      </span>

                    </div>

                  </button>
                `;

              }
            )
            .join("")
        }
      </div>
    `;

  container
    .querySelectorAll(
      "[data-artist]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const artist =
            button.dataset.artist;

          const artistTracks =
            tracks.filter(
              track =>
                track.artist ===
                artist
            );

          if (artistTracks.length) {

            playTrack(
              artistTracks[0].id
            );

          }

        }
      );

    });

}


function renderPlaylists(container) {

  container.innerHTML = `
    <div class="empty-small">
      <span>♫</span>
      <p>
        Playlist creation is ready for the next expansion.
      </p>
    </div>
  `;

}


/* =========================================================
   HOME RENDER
   ========================================================= */

function renderEverything() {

  $("libraryCount").textContent =
    `${tracks.length} song${tracks.length === 1 ? "" : "s"}`;

  renderRecent();

  renderAlbumPreview();

  renderArtistPreview();

  renderLibraryTab(
    "songs"
  );

  renderSearch();

  updatePlayerUI();

}


function renderRecent() {

  const container =
    $("recentList");

  const recent =
    [...tracks]
      .filter(
        track =>
          track.lastPlayed
      )
      .sort(
        (a, b) =>
          b.lastPlayed -
          a.lastPlayed
      )
      .slice(
        0,
        8
      );

  if (!recent.length) {

    container.innerHTML = `
      <div class="empty-small">
        <span>♪</span>
        <p>Your recently played songs will appear here.</p>
      </div>
    `;

    return;

  }

  container.innerHTML =
    recent
      .map(
        track => `
          <button
            class="horizontal-track"
            data-track-id="${track.id}"
          >

            <img
              class="horizontal-art"
              src="${getArtworkUrl(track)}"
              alt=""
            >

            <span class="horizontal-title">
              ${escapeHTML(track.title)}
            </span>

            <span class="horizontal-artist">
              ${escapeHTML(track.artist)}
            </span>

          </button>
        `
      )
      .join("");

  container
    .querySelectorAll(
      "[data-track-id]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          playTrack(
            button.dataset.trackId
          );

        }
      );

    });

}


function renderAlbumPreview() {

  const container =
    $("albumPreview");

  const albums =
    uniqueAlbums(
      tracks
    )
      .slice(
        0,
        7
      );

  container.innerHTML =
    albums
      .map(
        album => {

          const track =
            tracks.find(
              item =>
                item.album ===
                album
            );

          const count =
            tracks.filter(
              item =>
                item.album ===
                album
            ).length;

          return `
            <button
              class="album-card"
              data-album="${escapeAttr(album)}"
            >

              <img
                class="album-art"
                src="${getArtworkUrl(track)}"
                alt=""
              >

              <span class="album-name">
                ${escapeHTML(album)}
              </span>

              <span class="album-meta">
                ${count} song${count === 1 ? "" : "s"}
              </span>

            </button>
          `;

        }
      )
      .join("");

  container
    .querySelectorAll(
      "[data-album]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const album =
            button.dataset.album;

          const track =
            tracks.find(
              item =>
                item.album ===
                album
            );

          if (track) {

            playTrack(
              track.id
            );

          }

        }
      );

    });

}


function renderArtistPreview() {

  const container =
    $("artistPreview");

  const artists =
    uniqueArtists(
      tracks
    )
      .slice(
        0,
        8
      );

  container.innerHTML =
    artists
      .map(
        artist => {

          const track =
            tracks.find(
              item =>
                item.artist ===
                artist
            );

          return `
            <button
              class="artist-card"
              data-artist="${escapeAttr(artist)}"
            >

              <img
                class="artist-avatar"
                src="${getArtworkUrl(track)}"
                alt=""
              >

              <span class="artist-name">
                ${escapeHTML(artist)}
              </span>

            </button>
          `;

        }
      )
      .join("");

  container
    .querySelectorAll(
      "[data-artist]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const track =
            tracks.find(
              item =>
                item.artist ===
                button.dataset.artist
            );

          if (track) {

            playTrack(
              track.id
            );

          }

        }
      );

    });

}


/* =========================================================
   TRACK HTML
   ========================================================= */

function trackHTML(track) {

  const playing =
    track.id ===
    currentTrackId;

  const sourceLabel =
    track.sourceType === "local"
      ? "LOCAL"
      : "CLOUD";

  return `
    <div
      class="track-item ${
        playing
          ? "playing"
          : ""
      }"
      data-track-id="${track.id}"
    >

      <img
        class="track-art"
        src="${getArtworkUrl(track)}"
        alt=""
      >

      <button
        class="track-info"
        data-play-track="${track.id}"
      >

        <span class="track-title">
          ${escapeHTML(track.title)}
        </span>

        <span class="track-artist">
          ${escapeHTML(track.artist)}
          ${track.album ? " • " + escapeHTML(track.album) : ""}
        </span>

        <span class="track-source">
          ${sourceLabel}
        </span>

      </button>

      ${
        playing
          ? `<span class="track-playing-dot"></span>`
          : ""
      }

      <button
        class="track-more"
        data-more-track="${track.id}"
      >
        ⋮
      </button>

    </div>
  `;

}


function attachTrackEvents(container) {

  container
    .querySelectorAll(
      "[data-play-track]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          playTrack(
            button.dataset.playTrack
          );

        }
      );

    });

  container
    .querySelectorAll(
      "[data-more-track]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          openContextSheet(
            button.dataset.moreTrack
          );

        }
      );

    });

}


/* =========================================================
   QUICK ACTIONS
   ========================================================= */

function handleQuickAction(
  action
) {

  switch (action) {

    case "history":

      showPage(
        "homePage"
      );

      renderRecent();

      document
        .querySelector(".content-section")
        ?.scrollIntoView({
          behavior: "smooth"
        });

      break;

    case "favorites":

      showPage(
        "libraryPage"
      );

      renderFavoritesLibrary();

      break;

    case "shuffle":

      if (!tracks.length) {

        showToast(
          "Add music first."
        );

        return;

      }

      shuffleEnabled = true;

      const random =
        tracks[
          Math.floor(
            Math.random() *
            tracks.length
          )
        ];

      playTrack(
        random.id
      );

      break;

    case "albums":

      showPage(
        "libraryPage"
      );

      document
        .querySelectorAll(
          "[data-library-tab]"
        )
        .forEach(button => {

          button.classList.toggle(
            "active",
            button.dataset.libraryTab ===
              "albums"
          );

        });

      renderLibraryTab(
        "albums"
      );

      break;

    case "artists":

      showPage(
        "libraryPage"
      );

      document
        .querySelectorAll(
          "[data-library-tab]"
        )
        .forEach(button => {

          button.classList.toggle(
            "active",
            button.dataset.libraryTab ===
              "artists"
          );

        });

      renderLibraryTab(
        "artists"
      );

      break;

  }

}


function renderFavoritesLibrary() {

  const container =
    $("libraryContent");

  const favorites =
    tracks.filter(
      track =>
        track.favorite
    );

  if (!favorites.length) {

    container.innerHTML = `
      <div class="empty-small">
        <span>♡</span>
        <p>You haven't added any favorites yet.</p>
      </div>
    `;

    return;

  }

  container.innerHTML =
    `<div class="track-list">
      ${
        favorites
          .map(trackHTML)
          .join("")
      }
    </div>`;

  attachTrackEvents(
    container
  );

}


/* =========================================================
   PAGES / SHEETS / MODALS
   ========================================================= */

function showPage(pageId) {

  document
    .querySelectorAll(".page")
    .forEach(page => {

      page.classList.toggle(
        "active",
        page.id === pageId
      );

    });

  document
    .querySelectorAll(
      ".nav-item[data-page]"
    )
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.page ===
          pageId
      );

    });

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


function openSourceSheet() {

  openSheet(
    "sourceSheet"
  );

}


function openSheet(id) {

  closeAllSheets();

  $(id)
    .classList.add(
      "open"
    );

}


function closeAllSheets() {

  document
    .querySelectorAll(
      ".bottom-sheet"
    )
    .forEach(sheet => {

      sheet.classList.remove(
        "open"
      );

    });

}


function openModal(id) {

  closeAllModals();

  $(id)
    .classList.add(
      "open"
    );

}


function closeModal(id) {

  $(id)
    ?.classList.remove(
      "open"
    );

}


function closeAllModals() {

  document
    .querySelectorAll(
      ".modal-backdrop"
    )
    .forEach(modal => {

      modal.classList.remove(
        "open"
      );

    });

}


/* =========================================================
   SLEEP TIMER
   ========================================================= */

function setSleepTimer(minutes) {

  cancelSleepTimer();

  sleepTimer =
    minutes;

  sleepTimeout =
    setTimeout(
      () => {

        audio.pause();

        sleepTimer =
          null;

        showToast(
          "Sleep timer stopped playback."
        );

      },
      minutes *
      60 *
      1000
    );

  showToast(
    `Sleep timer: ${minutes} minutes`
  );

}


function cancelSleepTimer() {

  if (
    sleepTimeout
  ) {

    clearTimeout(
      sleepTimeout
    );

  }

  sleepTimeout =
    null;

  sleepTimer =
    null;

}


/* =========================================================
   SETTINGS
   ========================================================= */

async function showSettings() {

  let storageMarkup = "Unavailable";

  if (navigator.storage && navigator.storage.estimate) {

    try {

      const { usage, quota } =
        await navigator.storage.estimate();

      const usedGB =
        (usage / (1024 ** 3)).toFixed(2);

      const totalGB =
        (quota / (1024 ** 3)).toFixed(1);

      const remainingGB =
        Math.max(0, (quota - usage) / (1024 ** 3)).toFixed(2);

      storageMarkup =
        `${usedGB} GB of ${totalGB} GB used • <span class="storage-left-red">${remainingGB} GB left</span>`;

    } catch {}

  }

  const localCount =
    tracks.filter(t => t.sourceType === "local").length;

  const remoteCount =
    tracks.length - localCount;

  $("settingsStatsText").textContent =
    `${tracks.length} tracks total (${localCount} local, ${remoteCount} remote)`;

  $("settingsStorageText").innerHTML =
    storageMarkup;

  openSheet("settingsSheet");

}


/* =========================================================
   MEDIA SESSION
   ========================================================= */

function updateMediaSession(track) {

  if (
    !("mediaSession" in navigator)
  ) return;

  const artwork =
    getArtworkUrl(track);

  try {

    navigator.mediaSession.metadata =
      new MediaMetadata({

        title:
          track.title,

        artist:
          track.artist,

        album:
          track.album,

        artwork: [
          {
            src:
              artwork,

            sizes:
              "512x512",

            type:
              "image/png"
          }
        ]

      });

  } catch {}

}


/* =========================================================
   AUDIO ERROR
   ========================================================= */

function handleAudioError() {

  if (!currentTrackId) return;

  showToast("Audio stream unavailable or blocked by CORS.");

}


/* =========================================================
   RESTORE PLAYBACK
   ========================================================= */

async function restorePlaybackState() {

  try {

    const settings =
      await dbGet(
        STORE_SETTINGS,
        "playback"
      );

    if (!settings) return;

    currentTrackId =
      settings.currentTrackId ||
      null;

    queue =
      settings.queue ||
      [];

    queueIndex =
      settings.queueIndex ??
      -1;

    shuffleEnabled =
      !!settings.shuffleEnabled;

    repeatMode =
      settings.repeatMode ||
      "off";

    const track =
      tracks.find(
        item =>
          item.id ===
          currentTrackId
      );

    if (track) {

      if (
        track.sourceType ===
        "local" &&
        track.blob
      ) {

        currentObjectUrl =
          URL.createObjectURL(
            track.blob
          );

        audio.src =
          currentObjectUrl;

      } else if (
        track.url
      ) {

        audio.src =
          track.url;

      }

      audio.currentTime =
        settings.position ||
        0;

      updatePlayerUI();

    }

  } catch (error) {

    console.warn(
      "Restore failed:",
      error
    );

  }

}


/* =========================================================
   HELPERS
   ========================================================= */

function uniqueAlbums(items) {

  return [
    ...new Set(
      items
        .map(
          track =>
            track.album
        )
        .filter(Boolean)
    )
  ];

}


function uniqueArtists(items) {

  return [
    ...new Set(
      items
        .map(
          track =>
            track.artist
        )
        .filter(Boolean)
    )
  ];

}


function libraryEmptyHTML() {

  return `
    <div class="empty-small">

      <span>♫</span>

      <p>
        Your library is empty.<br>
        Add music to start listening.
      </p>

    </div>
  `;

}


function escapeHTML(value) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}


function escapeAttr(value) {

  return escapeHTML(
    value
  );

}


/* =========================================================
   TOAST
   ========================================================= */

function showToast(message) {

  $("toastText").textContent =
    message;

  $("toast")
    .classList.add(
      "show"
    );

  clearTimeout(
    toastTimer
  );

  toastTimer =
    setTimeout(
      () => {

        $("toast")
          .classList.remove(
            "show"
          );

      },
      2500
    );

}


/* =========================================================
   DEFAULT ARTWORK
   ========================================================= */

function createDefaultArtwork() {

  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="600"
      height="600"
      viewBox="0 0 600 600"
    >

      <defs>

        <linearGradient
          id="bg"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >

          <stop
            offset="0%"
            stop-color="#15284f"
          />

          <stop
            offset="55%"
            stop-color="#0b1224"
          />

          <stop
            offset="100%"
            stop-color="#03050a"
          />

        </linearGradient>

        <radialGradient id="glow">

          <stop
            offset="0%"
            stop-color="#789bff"
            stop-opacity=".8"
          />

          <stop
            offset="100%"
            stop-color="#789bff"
            stop-opacity="0"
          />

        </radialGradient>

      </defs>

      <rect
        width="600"
        height="600"
        fill="url(#bg)"
      />

      <circle
        cx="300"
        cy="290"
        r="230"
        fill="url(#glow)"
        opacity=".45"
      />

      <circle
        cx="300"
        cy="300"
        r="160"
        fill="none"
        stroke="#91adff"
        stroke-opacity=".35"
        stroke-width="3"
      />

      <circle
        cx="300"
        cy="300"
        r="115"
        fill="#0a1121"
        stroke="#7599ff"
        stroke-opacity=".5"
        stroke-width="3"
      />

      <path
        d="M330 220v145a50 50 0 1 1-30-46V180l145-35v45z"
        fill="#8aa8ff"
      />

      <text
        x="300"
        y="500"
        text-anchor="middle"
        fill="#ffffff"
        fill-opacity=".7"
        font-family="Arial"
        font-size="28"
        font-weight="700"
        letter-spacing="7"
      >
        LASTMUSIC
      </text>

    </svg>
  `;

  return (
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
      svg
    )
  );

}
