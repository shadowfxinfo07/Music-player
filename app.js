
/* =========================================================
   LASTMUSIC — BY SACHIN
   Premium local-first music player
   ========================================================= */

"use strict";

/* -------------------- CONFIG -------------------- */

const DB_NAME = "LastMusicDB";
const DB_VERSION = 2;
const STORE_TRACKS = "tracks";
const STORE_SETTINGS = "settings";

const DEFAULT_ART = createDefaultArtwork();

let db = null;
let tracks = [];
let currentTrackId = null;
let queue = [];
let queueIndex = -1;
let isPlaying = false;
let shuffleEnabled = false;
let repeatMode = "off";

let sleepTimer = null;
let sleepTimeout = null;
let currentContextTrackId = null;
let currentEditTrackId = null;
let currentSearchFilter = "all";
let currentObjectUrl = null;
let toastTimer = null;
let pendingArtwork = null;
let pendingArtworkUrl = null;
let lastPositionSave = -1;

const artworkUrls = new Map();
const $ = id => document.getElementById(id);

const audio = $("audio");
const miniPlayer = $("miniPlayer");
const nowPlaying = $("nowPlaying");

/* -------------------- STARTUP -------------------- */

async function initializeApp() {
  try {
    await initDB();
  } catch (error) {
    console.warn("Database unavailable:", error);
    showToast("Storage unavailable. Some features may not save.");
  }

  try {
    await loadLibrary();
  } catch (error) {
    console.error("Library loading failed:", error);
    tracks = [];
  }

  bindEvents();
  renderEverything();
  await restorePlaybackState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp, {
    once: true
  });
} else {
  initializeApp();
}

/* -------------------- DATABASE -------------------- */

function initDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_TRACKS)) {
        const store = database.createObjectStore(STORE_TRACKS, {
          keyPath: "id"
        });

        store.createIndex("title", "title", { unique: false });
        store.createIndex("artist", "artist", { unique: false });
        store.createIndex("album", "album", { unique: false });
      }

      if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
        database.createObjectStore(STORE_SETTINGS, {
          keyPath: "key"
        });
      }
    };

    request.onsuccess = () => {
      db = request.result;

      db.onversionchange = () => {
        db.close();
        db = null;
      };

      resolve();
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn("Database upgrade is blocked by another tab.");
    };
  });
}

function dbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database is not ready"));
      return;
    }

    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve([]);
      return;
    }

    const request = db.transaction(storeName, "readonly")
      .objectStore(storeName)
      .getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function dbGet(storeName, id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve(null);
      return;
    }

    const request = db.transaction(storeName, "readonly")
      .objectStore(storeName)
      .get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function dbDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database is not ready"));
      return;
    }

    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function dbClearLibrary() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database is not ready"));
      return;
    }

    const transaction = db.transaction(
      [STORE_TRACKS, STORE_SETTINGS],
      "readwrite"
    );

    transaction.objectStore(STORE_TRACKS).clear();
    transaction.objectStore(STORE_SETTINGS).clear();

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/* -------------------- CLOUD CATALOG -------------------- */

async function fetchCloudTracks() {
  const catalog = Array.isArray(window.CLOUD_SONGS)
    ? window.CLOUD_SONGS
    : [];

  return catalog
    .filter(item => item && typeof item === "object")
    .map((item, index) => {
      const url = item.url || item.src || item.audio || item.file || "";
      const id = item.id || `cloud_${url || item.title || index}`;

      return {
        ...item,
        id: String(id),
        sourceType: item.sourceType || "cloud",
        url,
        title: item.title || cleanFileName(url.split("/").pop() || "Untitled"),
        artist: item.artist || "Unknown artist",
        album: item.album || "Unknown album",
        artworkUrl:
          item.artworkUrl ||
          (typeof item.artwork === "string" ? item.artwork : "") ||
          item.cover ||
          item.image ||
          "",
        favorite: !!item.favorite,
        playCount: Number(item.playCount) || 0,
        lastPlayed: Number(item.lastPlayed) || 0
      };
    })
    .filter(track => track.url);
}

/* -------------------- LIBRARY -------------------- */

async function loadLibrary() {
  const [savedTracks, cloudTracks] = await Promise.all([
    dbGetAll(STORE_TRACKS),
    fetchCloudTracks()
  ]);

  const savedIds = new Set(savedTracks.map(track => track.id));

  tracks = [
    ...savedTracks,
    ...cloudTracks.filter(track => !savedIds.has(track.id))
  ];

  tracks.sort((a, b) =>
    (a.title || "").localeCompare(b.title || "")
  );
}

async function saveTrack(track) {
  if (!db || !track) return;
  await dbPut(STORE_TRACKS, track);
}

async function saveSettings() {
  if (!db) return;

  try {
    await dbPut(STORE_SETTINGS, {
      key: "playback",
      currentTrackId,
      queue,
      queueIndex,
      shuffleEnabled,
      repeatMode,
      position: currentTrackId ? audio.currentTime || 0 : 0
    });
  } catch (error) {
    console.warn("Playback settings could not be saved:", error);
  }
}

/* -------------------- EVENTS -------------------- */

function bindEvents() {
  const on = (id, event, callback) => {
    const element = $(id);
    if (element) element.addEventListener(event, callback);
  };

  document.querySelectorAll(".nav-item[data-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  document.addEventListener("click", event => {
    const openSheet = document.querySelector(".bottom-sheet.open");
    if (!openSheet) return;

    const opensSheet = event.target.closest(
      "[data-more-track], #npMore, #queueBtn, #settingsBtn, " +
      "#createNavBtn, #libraryAddBtn"
    );

    if (!openSheet.contains(event.target) && !opensSheet) {
      closeAllSheets();
    }
  });

  document.querySelectorAll(".bottom-sheet").forEach(sheet => {
    let startY = 0;

    sheet.addEventListener("touchstart", event => {
      startY = event.touches[0].clientY;
    }, { passive: true });

    sheet.addEventListener("touchend", event => {
      if (event.changedTouches[0].clientY - startY > 60) {
        closeAllSheets();
      }
    }, { passive: true });
  });

  on("createNavBtn", "click", openSourceSheet);
  on("libraryAddBtn", "click", openSourceSheet);

  on("importHomeBtn", "click", () => {
    closeAllSheets();
    $("fileInput")?.click();
  });

  on("sourceFiles", "click", () => {
    closeAllSheets();
    $("fileInput")?.click();
  });

  on("sourceFolder", "click", () => {
    closeAllSheets();
    $("folderInput")?.click();
  });

  ["fileInput", "folderInput"].forEach(id => {
    on(id, "change", event => {
      const files = [...(event.target.files || [])];
      event.target.value = "";
      importFiles(files);
    });
  });

  on("miniMain", "click", openNowPlaying);
  on("openNowPlayingNav", "click", openNowPlaying);

  on("miniPlay", "click", event => {
    event.stopPropagation();
    togglePlay();
  });

  on("miniNext", "click", event => {
    event.stopPropagation();
    nextTrack();
  });

  on("miniFavorite", "click", event => {
    event.stopPropagation();
    toggleCurrentFavorite();
  });

  on("closeNowPlaying", "click", closeNowPlaying);
  on("playBtn", "click", togglePlay);
  on("previousBtn", "click", previousTrack);
  on("nextBtn", "click", nextTrack);
  on("shuffleBtn", "click", toggleShuffle);
  on("repeatBtn", "click", cycleRepeat);
  on("npFavorite", "click", toggleCurrentFavorite);
  on("seekBar", "input", seekAudio);

  if (audio) {
    audio.addEventListener("timeupdate", updateProgress);
    audio.addEventListener("loadedmetadata", () => {
      updateDuration();

      if (Number.isFinite(audio._restorePosition)) {
        const position = audio._restorePosition;
        delete audio._restorePosition;

        try {
          audio.currentTime = Math.min(position, audio.duration || position);
        } catch {}
      }
    });

    audio.addEventListener("play", () => {
      isPlaying = true;
      updatePlayerUI();
    });

    audio.addEventListener("pause", () => {
      isPlaying = false;
      updatePlayerUI();
    });

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleAudioError);
  }

  on("sleepBtn", "click", () => openModal("sleepModal"));



  on("queueBtn", "click", openQueue);

  on("npMore", "click", () => {
    if (currentTrackId) openContextSheet(currentTrackId);
  });

  on("settingsBtn", "click", showSettings);

  on("clearLibraryBtn", "click", () => {
    closeAllSheets();
    openModal("clearConfirmModal");
  });

  on("executeClearBtn", "click", async () => {
    try {
      await dbClearLibrary();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();

      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;

      artworkUrls.forEach(url => URL.revokeObjectURL(url));
      artworkUrls.clear();

      tracks = [];
      queue = [];
      queueIndex = -1;
      currentTrackId = null;
      isPlaying = false;

      closeAllModals();
      renderEverything();
      updatePlayerUI();
      showToast("Library cleared");
    } catch (error) {
      console.error(error);
      showToast("Could not clear the library.");
    }
  });

  on("saveEditBtn", "click", saveEditedTrack);
  on("artInput", "change", previewArtwork);

  document.querySelectorAll("[data-sleep]").forEach(button => {
    button.addEventListener("click", () => {
      setSleepTimer(Number(button.dataset.sleep));
      closeModal("sleepModal");
    });
  });

  on("cancelSleep", "click", cancelSleepTimer);

  on("searchInput", "input", renderSearch);

  on("clearSearch", "click", () => {
    if ($("searchInput")) $("searchInput").value = "";
    renderSearch();
  });

  document.querySelectorAll("[data-search-filter]").forEach(button => {
    button.addEventListener("click", () => {
      currentSearchFilter = button.dataset.searchFilter;

      document.querySelectorAll("[data-search-filter]").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      renderSearch();
    });
  });

  document.querySelectorAll("[data-library-tab]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-library-tab]").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      renderLibraryTab(button.dataset.libraryTab);
    });
  });

  document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      handleQuickAction(button.dataset.action);
    });
  });

  document.querySelectorAll("[data-context]").forEach(button => {
    button.addEventListener("click", () => {
      handleContextAction(button.dataset.context);
    });
  });

  document.querySelectorAll("[data-close-sheet]").forEach(button => {
    button.addEventListener("click", closeAllSheets);
  });

  document.querySelectorAll("[data-close-modal]").forEach(button => {
    button.addEventListener("click", closeAllModals);
  });

  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) backdrop.classList.remove("open");
    });
  });

  document.addEventListener("keydown", event => {
    const tag = document.activeElement?.tagName;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);

    if (event.code === "Space" && !typing) {
      event.preventDefault();
      togglePlay();
    }

    if (!typing && currentTrackId && event.code === "ArrowRight") {
      audio.currentTime = Math.min(
        audio.duration || Infinity,
        audio.currentTime + 5
      );
    }

    if (!typing && currentTrackId && event.code === "ArrowLeft") {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    }
  });

  if ("mediaSession" in navigator) {
    const setAction = (name, handler) => {
      try {
        navigator.mediaSession.setActionHandler(name, handler);
      } catch {}
    };

    setAction("play", () => audio.play().catch(() => {}));
    setAction("pause", () => audio.pause());
    setAction("previoustrack", previousTrack);
    setAction("nexttrack", nextTrack);
    setAction("seekbackward", () => {
      audio.currentTime = Math.max(0, audio.currentTime - 10);
    });
    setAction("seekforward", () => {
      audio.currentTime = Math.min(
        audio.duration || Infinity,
        audio.currentTime + 10
      );
    });
  }

  window.addEventListener("pagehide", () => {
    saveSettings();
  });
}

/* -------------------- IMPORT LOCAL MUSIC -------------------- */

async function importFiles(files) {
  const audioFiles = files.filter(file =>
    file.type.startsWith("audio/") ||
    /\.(mp3|m4a|aac|flac|wav|ogg|opus|webm)$/i.test(file.name)
  );

  if (!audioFiles.length) {
    showToast("No audio files found.");
    return;
  }

  showToast(`Importing ${audioFiles.length} song(s)...`);

  let imported = 0;

  for (const file of audioFiles) {
    try {
      const metadata = await readMetadata(file);

      const track = {
        id: "local_" + createId(),
        sourceType: "local",
        blob: file,
        title: metadata.title || cleanFileName(file.name),
        artist: metadata.artist || "Unknown artist",
        album: metadata.album || "Unknown album",
        artwork: metadata.artwork || null,
        artworkUrl: "",
        filename: file.name,
        duration: 0,
        favorite: false,
        playCount: 0,
        lastPlayed: 0,
        createdAt: Date.now()
      };

      await saveTrack(track);
      tracks.push(track);
      imported++;
    } catch (error) {
      console.error("Import failed:", file.name, error);
    }
  }

  tracks.sort((a, b) =>
    (a.title || "").localeCompare(b.title || "")
  );

  renderEverything();
  showToast(`${imported} song${imported === 1 ? "" : "s"} added`);
}

function createId() {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch {}

  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function readMetadata(file) {
  return new Promise(resolve => {
    if (typeof jsmediatags === "undefined") {
      resolve({});
      return;
    }

    try {
      jsmediatags.read(file, {
        onSuccess: result => {
          const tags = result.tags || {};
          let artwork = null;

          if (tags.picture?.data) {
            artwork = new Blob(
              [new Uint8Array(tags.picture.data)],
              { type: tags.picture.format || "image/jpeg" }
            );
          }

          resolve({
            title: tags.title || "",
            artist: tags.artist || "",
            album: tags.album || "",
            artwork
          });
        },
        onError: () => resolve({})
      });
    } catch {
      resolve({});
    }
  });
}

function cleanFileName(name) {
  return String(name || "")
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

/* -------------------- PLAYBACK -------------------- */

async function playTrack(trackId, addToHistory = true) {
  const track = tracks.find(item => item.id === trackId);

  if (!track) {
    showToast("Song not found.");
    return;
  }

  if (track.sourceType === "local" && !track.blob) {
    showToast("This local file is no longer available.");
    return;
  }

  if (track.sourceType !== "local" && !track.url) {
    showToast("This cloud song has no playable audio URL.");
    return;
  }

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  currentTrackId = track.id;
  queueIndex = queue.indexOf(track.id);

  if (track.sourceType === "local") {
    currentObjectUrl = URL.createObjectURL(track.blob);
    audio.src = currentObjectUrl;
  } else {
    audio.src = track.url;
  }

  updatePlayerUI();
  updateTrackPlayingIndicators();

  try {
    await audio.play();
  } catch (error) {
    console.warn("Playback failed:", error);
    isPlaying = false;
    updatePlayerUI();
    showToast("This song could not be played.");
    return;
  }

  if (addToHistory) {
    track.playCount = (track.playCount || 0) + 1;
    track.lastPlayed = Date.now();

    try {
      await saveTrack(track);
    } catch (error) {
      console.warn("Could not save track history:", error);
    }
  }

  updateMediaSession(track);
  await saveSettings();
  renderRecent();
}

function togglePlay() {
  if (!currentTrackId) {
    if (tracks.length) {
      playTrack(tracks[0].id);
    } else {
      showToast("Add some music first.");
    }
    return;
  }

  if (audio.paused) {
    audio.play().catch(() => {
      showToast("Playback could not start.");
    });
  } else {
    audio.pause();
  }
}

function previousTrack() {
  if (!currentTrackId) return;

  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }

  if (queueIndex > 0) {
    queueIndex--;
    playTrack(queue[queueIndex]);
    return;
  }

  if (!tracks.length) return;

  const index = tracks.findIndex(track => track.id === currentTrackId);
  const previous = tracks[index <= 0 ? tracks.length - 1 : index - 1];

  if (previous) playTrack(previous.id);
}

function nextTrack() {
  if (!currentTrackId) return;

  if (repeatMode === "one") {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }

  if (queueIndex >= 0 && queueIndex < queue.length - 1) {
    playTrack(queue[queueIndex + 1]);
    return;
  }

  if (shuffleEnabled) {
    const available = tracks.filter(track => track.id !== currentTrackId);

    if (!available.length) {
      if (repeatMode === "all") playTrack(currentTrackId);
      return;
    }

    const next = available[Math.floor(Math.random() * available.length)];
    playTrack(next.id);
    return;
  }

  const index = tracks.findIndex(track => track.id === currentTrackId);
  let nextIndex = index + 1;

  if (nextIndex >= tracks.length) {
    if (repeatMode !== "all") return;
    nextIndex = 0;
  }

  if (tracks[nextIndex]) playTrack(tracks[nextIndex].id);
}

function handleEnded() {
  if (repeatMode === "one") {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } else {
    nextTrack();
  }
}

/* -------------------- PROGRESS -------------------- */

function updateProgress() {
  const duration = audio.duration || 0;
  const current = audio.currentTime || 0;
  const percent = duration ? current / duration * 100 : 0;
  const seek = $("seekBar");

  if (seek) {
    seek.value = percent;
    seek.style.background = `linear-gradient(
      90deg,
      #789bff 0%,
      #789bff ${percent}%,
      rgba(255,255,255,.09) ${percent}%,
      rgba(255,255,255,.09) 100%
    )`;
  }

  if ($("currentTime")) $("currentTime").textContent = formatTime(current);
  if ($("miniProgress")) $("miniProgress").style.width = percent + "%";

  const bucket = Math.floor(current / 5);
  if (bucket !== lastPositionSave) {
    lastPositionSave = bucket;
    saveSettings();
  }
}

function updateDuration() {
  if ($("duration")) $("duration").textContent = formatTime(audio.duration);
}

function seekAudio() {
  if (!audio.duration || !$("seekBar")) return;
  audio.currentTime = audio.duration * (Number($("seekBar").value) / 100);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");

  return `${mins}:${secs}`;
}

/* -------------------- ARTWORK -------------------- */

function getArtworkUrl(track) {
  if (!track) return DEFAULT_ART;

  if (track.artworkUrl) return track.artworkUrl;

  if (track.artwork instanceof Blob) {
    if (!artworkUrls.has(track.id)) {
      artworkUrls.set(track.id, URL.createObjectURL(track.artwork));
    }
    return artworkUrls.get(track.id);
  }

  return DEFAULT_ART;
}

function revokeArtworkUrl(trackId) {
  const url = artworkUrls.get(trackId);

  if (url) {
    URL.revokeObjectURL(url);
    artworkUrls.delete(trackId);
  }
}

function updateDynamicAccent(track) {
  const fallback = () => {
    document.documentElement.style.setProperty("--accent-rgb", "93,140,255");
  };

  if (!track || (!track.artwork && !track.artworkUrl)) {
    fallback();
    return;
  }

  let url = track.artworkUrl || "";
  let temporaryUrl = false;

  if (!url && track.artwork instanceof Blob) {
    url = getArtworkUrl(track);
  }

  if (!url) {
    fallback();
    return;
  }

  const image = new Image();
  image.crossOrigin = "anonymous";

  image.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;

      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, 1, 1);

      const data = context.getImageData(0, 0, 1, 1).data;
      document.documentElement.style.setProperty(
        "--accent-rgb",
        `${data[0]},${data[1]},${data[2]}`
      );
    } catch {
      fallback();
    }

    if (temporaryUrl) URL.revokeObjectURL(url);
  };

  image.onerror = () => {
    fallback();
    if (temporaryUrl) URL.revokeObjectURL(url);
  };

  image.src = url;
}

/* -------------------- PLAYER UI -------------------- */

function updatePlayerUI() {
  const track = tracks.find(item => item.id === currentTrackId);

  if (!track) {
    miniPlayer?.classList.add("hidden");
    if ($("visualizer")) $("visualizer").classList.add("paused");
    return;
  }

  miniPlayer?.classList.remove("hidden");

  const art = getArtworkUrl(track);

  if ($("miniArt")) $("miniArt").src = art;
  if ($("npArt")) $("npArt").src = art;
  if ($("miniTitle")) $("miniTitle").textContent = track.title;
  if ($("miniArtist")) $("miniArtist").textContent = track.artist;
  if ($("npTitle")) $("npTitle").textContent = track.title;
  if ($("npArtist")) $("npArtist").textContent = `${track.artist} • ${track.album}`;

  const favorite = !!track.favorite;

  if ($("miniFavorite")) $("miniFavorite").textContent = favorite ? "♥" : "♡";
  if ($("npFavorite")) {
    $("npFavorite").textContent = favorite ? "♥" : "♡";
    $("npFavorite").classList.toggle("active", favorite);
  }

  if ($("playBtn")) $("playBtn").textContent = isPlaying ? "Ⅱ" : "▶";
  if ($("miniPlay")) $("miniPlay").textContent = isPlaying ? "Ⅱ" : "▶";

  $("shuffleBtn")?.classList.toggle("active", shuffleEnabled);
  $("repeatBtn")?.classList.toggle("active", repeatMode !== "off");

  if ($("repeatBtn")) {
    $("repeatBtn").textContent = repeatMode === "one" ? "↻¹" : "↻";
  }

  $("visualizer")?.classList.toggle("paused", !isPlaying);
  $("npArtShell")?.classList.toggle("rotating", isPlaying);
  miniPlayer?.classList.toggle("playing", isPlaying);

  updateDynamicAccent(track);
  updateTrackPlayingIndicators();
}

function updateTrackPlayingIndicators() {
  document.querySelectorAll(".track-item[data-track-id]").forEach(item => {
    item.classList.toggle("playing", item.dataset.trackId === currentTrackId);
  });
}

/* -------------------- NOW PLAYING -------------------- */

function openNowPlaying() {
  if (!currentTrackId) {
    if (tracks.length) {
      playTrack(tracks[0].id);
    } else {
      showToast("Add music first.");
    }
    return;
  }

  nowPlaying?.classList.add("open");
  updatePlayerUI();
}

function closeNowPlaying() {
  nowPlaying?.classList.remove("open");
}

/* -------------------- FAVORITES -------------------- */

async function toggleCurrentFavorite() {
  if (currentTrackId) await toggleFavorite(currentTrackId);
}

async function toggleFavorite(id) {
  const track = tracks.find(item => item.id === id);
  if (!track) return;

  track.favorite = !track.favorite;

  try {
    await saveTrack(track);
  } catch (error) {
    console.warn("Could not save favorite:", error);
  }

  updatePlayerUI();
  renderEverything();

  showToast(track.favorite ? "Added to favorites" : "Removed from favorites");
}

/* -------------------- SHUFFLE / REPEAT -------------------- */

function toggleShuffle() {
  shuffleEnabled = !shuffleEnabled;
  updatePlayerUI();
  saveSettings();
  showToast(shuffleEnabled ? "Shuffle on" : "Shuffle off");
}

function cycleRepeat() {
  repeatMode = repeatMode === "off"
    ? "all"
    : repeatMode === "all"
      ? "one"
      : "off";

  updatePlayerUI();
  saveSettings();

  showToast({
    off: "Repeat off",
    all: "Repeat all",
    one: "Repeat song"
  }[repeatMode]);
}

/* -------------------- QUEUE -------------------- */

function addToQueue(id) {
  if (!tracks.some(track => track.id === id)) return;

  if (!queue.includes(id)) queue.push(id);

  saveSettings();
  showToast("Added to queue");
}

function openQueue() {
  renderQueue();
  openSheet("queueSheet");
}

function renderQueue() {
  const container = $("queueContent");
  if (!container) return;

  if (!queue.length) {
    container.innerHTML = `
      <div class="empty-small">
        <span>☷</span>
        <p>Your queue is empty.</p>
      </div>`;
    return;
  }

  container.innerHTML = queue.map((id, index) => {
    const track = tracks.find(item => item.id === id);
    if (!track) return "";

    return `
      <div class="queue-item ${id === currentTrackId ? "current" : ""}">
        <img src="${escapeAttr(getArtworkUrl(track))}" alt="">
        <div class="queue-item-info">
          <strong>${escapeHTML(track.title)}</strong>
          <span>${escapeHTML(track.artist)}</span>
        </div>
        <button class="queue-remove" data-remove-queue="${index}" aria-label="Remove from queue">×</button>
      </div>`;
  }).join("");

  container.querySelectorAll("[data-remove-queue]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeQueue);
      const removedId = queue[index];

      queue.splice(index, 1);

      if (index < queueIndex) queueIndex--;
      else if (removedId === currentTrackId) queueIndex = -1;

      renderQueue();
      saveSettings();
    });
  });
}

/* -------------------- CONTEXT MENU -------------------- */

function openContextSheet(id) {
  const track = tracks.find(item => item.id === id);
  if (!track) return;

  currentContextTrackId = id;

  if ($("contextArt")) $("contextArt").src = getArtworkUrl(track);
  if ($("contextTitle")) $("contextTitle").textContent = track.title;
  if ($("contextArtist")) $("contextArtist").textContent = track.artist;

  openSheet("contextSheet");
}

async function handleContextAction(action) {
  const id = currentContextTrackId;
  const track = tracks.find(item => item.id === id);

  closeAllSheets();
  if (!track) return;

  switch (action) {
    case "play":
      await playTrack(id);
      break;
    case "queue":
      addToQueue(id);
      break;
    case "favorite":
      await toggleFavorite(id);
      break;
    case "edit":
      openEditModal(id);
      break;
    case "share":
      await shareTrack(track);
      break;
    case "delete":
      await deleteTrack(id);
      break;
  }
}

/* -------------------- EDIT TRACK -------------------- */

function openEditModal(id) {
  const track = tracks.find(item => item.id === id);
  if (!track) return;

  currentEditTrackId = id;
  pendingArtwork = null;

  if (pendingArtworkUrl) URL.revokeObjectURL(pendingArtworkUrl);
  pendingArtworkUrl = null;

  if ($("editTitle")) $("editTitle").value = track.title || "";
  if ($("editArtist")) $("editArtist").value = track.artist || "";
  if ($("editAlbum")) $("editAlbum").value = track.album || "";
  if ($("editArtPreview")) $("editArtPreview").src = getArtworkUrl(track);

  if ($("artInput")) $("artInput").value = "";

  openModal("editModal");
}

function previewArtwork(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image file.");
    return;
  }

  pendingArtwork = file;

  if (pendingArtworkUrl) URL.revokeObjectURL(pendingArtworkUrl);
  pendingArtworkUrl = URL.createObjectURL(file);

  if ($("editArtPreview")) $("editArtPreview").src = pendingArtworkUrl;
}

async function saveEditedTrack() {
  const track = tracks.find(item => item.id === currentEditTrackId);
  if (!track) return;

  track.title = $("editTitle")?.value.trim() || "Untitled";
  track.artist = $("editArtist")?.value.trim() || "Unknown artist";
  track.album = $("editAlbum")?.value.trim() || "Unknown album";

  if (pendingArtwork) {
    revokeArtworkUrl(track.id);
    track.artwork = pendingArtwork;
    track.artworkUrl = "";
  }

  try {
    await saveTrack(track);
  } catch (error) {
    console.error(error);
    showToast("Could not save song details.");
    return;
  }

  pendingArtwork = null;

  if (pendingArtworkUrl) URL.revokeObjectURL(pendingArtworkUrl);
  pendingArtworkUrl = null;

  closeAllModals();
  renderEverything();
  updatePlayerUI();
  showToast("Song updated");
}

/* -------------------- DELETE TRACK -------------------- */

async function deleteTrack(id) {
  const track = tracks.find(item => item.id === id);
  if (!track) return;

  if (track.sourceType === "cloud") {
    showToast("Cloud tracks are managed in your songs catalog.");
    return;
  }

  try {
    await dbDelete(STORE_TRACKS, id);
  } catch (error) {
    console.error(error);
    showToast("Could not remove this song.");
    return;
  }

  tracks = tracks.filter(item => item.id !== id);

  const removedQueueIndex = queue.indexOf(id);
  if (removedQueueIndex >= 0) {
    queue.splice(removedQueueIndex, 1);
    if (removedQueueIndex < queueIndex) queueIndex--;
  }

  revokeArtworkUrl(id);

  if (currentTrackId === id) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;

    currentTrackId = null;
    isPlaying = false;
  }

  await saveSettings();
  renderEverything();
  updatePlayerUI();
  showToast("Removed from library");
}

/* -------------------- SHARE -------------------- */

async function shareTrack(track) {
  const text = `${track.title} — ${track.artist}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: track.title, text });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("Song info copied");
  } catch {
    showToast(text);
  }
}

/* -------------------- SEARCH -------------------- */

function renderSearch() {
  const input = $("searchInput");
  const container = $("searchResults");
  if (!input || !container) return;

  const query = input.value.trim().toLowerCase();

  if ($("clearSearch")) {
    $("clearSearch").style.display = query ? "block" : "none";
  }

  let results = tracks.filter(track => {
    if (!query) return true;

    const text = [track.title, track.artist, track.album]
      .join(" ")
      .toLowerCase();

    return text.includes(query);
  });

  if (currentSearchFilter === "songs") {
    results = results.filter(track => track.title);
  } else if (currentSearchFilter === "albums") {
    results = uniqueAlbums(results).map(album =>
      results.find(track => track.album === album)
    );
  } else if (currentSearchFilter === "artists") {
    results = uniqueArtists(results).map(artist =>
      results.find(track => track.artist === artist)
    );
  }

  results = results.filter(Boolean);

  if (!results.length) {
    container.innerHTML = `
      <div class="empty-small">
        <span>⌕</span>
        <p>${query ? "No matching music found." : "Your library is waiting for music."}</p>
      </div>`;
    return;
  }

  container.innerHTML = results.map(trackHTML).join("");
  attachTrackEvents(container);
}

/* -------------------- LIBRARY TABS -------------------- */

function renderLibraryTab(tab) {
  const container = $("libraryContent");
  if (!container) return;

  if (tab === "songs") renderSongs(container);
  else if (tab === "albums") renderAlbums(container);
  else if (tab === "artists") renderArtists(container);
  else if (tab === "playlists") renderPlaylists(container);
}

function renderSongs(container) {
  if (!tracks.length) {
    container.innerHTML = libraryEmptyHTML();
    return;
  }

  container.innerHTML = `<div class="track-list">${tracks.map(trackHTML).join("")}</div>`;
  attachTrackEvents(container);
}

function renderAlbums(container) {
  const albums = uniqueAlbums(tracks);

  if (!albums.length) {
    container.innerHTML = libraryEmptyHTML();
    return;
  }

  container.innerHTML = `<div class="library-grid">${albums.map(album => {
    const track = tracks.find(item => item.album === album);
    const count = tracks.filter(item => item.album === album).length;

    return `
      <button class="library-album" data-album="${escapeAttr(album)}">
        <img src="${escapeAttr(getArtworkUrl(track))}" alt="">
        <strong>${escapeHTML(album)}</strong>
        <span>${count} song${count === 1 ? "" : "s"}</span>
      </button>`;
  }).join("")}</div>`;

  container.querySelectorAll("[data-album]").forEach(button => {
    button.addEventListener("click", () => {
      const first = tracks.find(item => item.album === button.dataset.album);
      if (first) playTrack(first.id);
    });
  });
}

function renderArtists(container) {
  const artists = uniqueArtists(tracks);

  if (!artists.length) {
    container.innerHTML = libraryEmptyHTML();
    return;
  }

  container.innerHTML = `<div class="track-list">${artists.map(artist => {
    const track = tracks.find(item => item.artist === artist);
    const count = tracks.filter(item => item.artist === artist).length;

    return `
      <button class="artist-list-item" data-artist="${escapeAttr(artist)}">
        <img src="${escapeAttr(getArtworkUrl(track))}" alt="">
        <div>
          <strong>${escapeHTML(artist)}</strong>
          <span>${count} song${count === 1 ? "" : "s"}</span>
        </div>
      </button>`;
  }).join("")}</div>`;

  container.querySelectorAll("[data-artist]").forEach(button => {
    button.addEventListener("click", () => {
      const first = tracks.find(item => item.artist === button.dataset.artist);
      if (first) playTrack(first.id);
    });
  });
}

function renderPlaylists(container) {
  container.innerHTML = `
    <div class="empty-small">
      <span>♫</span>
      <p>Playlist creation is ready for a future update.</p>
    </div>`;
}

/* -------------------- HOME RENDERING -------------------- */

function renderEverything() {
  if ($("libraryCount")) {
    $("libraryCount").textContent =
      `${tracks.length} song${tracks.length === 1 ? "" : "s"}`;
  }

  renderRecent();
  renderAlbumPreview();
  renderArtistPreview();

  const activeTab = document.querySelector("[data-library-tab].active");
  renderLibraryTab(activeTab?.dataset.libraryTab || "songs");

  renderSearch();
  updatePlayerUI();
}

function renderRecent() {
  const container = $("recentList");
  if (!container) return;

  const recent = [...tracks]
    .filter(track => track.lastPlayed)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, 8);

  if (!recent.length) {
    container.innerHTML = `
      <div class="empty-small">
        <span>♪</span>
        <p>Your recently played songs will appear here.</p>
      </div>`;
    return;
  }

  container.innerHTML = recent.map(track => `
    <button class="horizontal-track" data-track-id="${escapeAttr(track.id)}">
      <img class="horizontal-art" src="${escapeAttr(getArtworkUrl(track))}" alt="">
      <span class="horizontal-title">${escapeHTML(track.title)}</span>
      <span class="horizontal-artist">${escapeHTML(track.artist)}</span>
    </button>`).join("");

  container.querySelectorAll("[data-track-id]").forEach(button => {
    button.addEventListener("click", () => playTrack(button.dataset.trackId));
  });
}

function renderAlbumPreview() {
  const container = $("albumPreview");
  if (!container) return;

  const albums = uniqueAlbums(tracks).slice(0, 7);

  container.innerHTML = albums.map(album => {
    const track = tracks.find(item => item.album === album);
    const count = tracks.filter(item => item.album === album).length;

    return `
      <button class="album-card" data-album="${escapeAttr(album)}">
        <img class="album-art" src="${escapeAttr(getArtworkUrl(track))}" alt="">
        <span class="album-name">${escapeHTML(album)}</span>
        <span class="album-meta">${count} song${count === 1 ? "" : "s"}</span>
      </button>`;
  }).join("");

  container.querySelectorAll("[data-album]").forEach(button => {
    button.addEventListener("click", () => {
      const track = tracks.find(item => item.album === button.dataset.album);
      if (track) playTrack(track.id);
    });
  });
}

function renderArtistPreview() {
  const container = $("artistPreview");
  if (!container) return;

  const artists = uniqueArtists(tracks).slice(0, 8);

  container.innerHTML = artists.map(artist => {
    const track = tracks.find(item => item.artist === artist);

    return `
      <button class="artist-card" data-artist="${escapeAttr(artist)}">
        <img class="artist-avatar" src="${escapeAttr(getArtworkUrl(track))}" alt="">
        <span class="artist-name">${escapeHTML(artist)}</span>
      </button>`;
  }).join("");

  container.querySelectorAll("[data-artist]").forEach(button => {
    button.addEventListener("click", () => {
      const track = tracks.find(item => item.artist === button.dataset.artist);
      if (track) playTrack(track.id);
    });
  });
}

/* -------------------- TRACK HTML -------------------- */

function trackHTML(track) {
  const playing = track.id === currentTrackId;
  const sourceLabel = track.sourceType === "local" ? "LOCAL" : "CLOUD";

  return `
    <div class="track-item ${playing ? "playing" : ""}" data-track-id="${escapeAttr(track.id)}">
      <img class="track-art" src="${escapeAttr(getArtworkUrl(track))}" alt="">

      <button class="track-info" data-play-track="${escapeAttr(track.id)}">
        <span class="track-title">${escapeHTML(track.title)}</span>
        <span class="track-artist">
          ${escapeHTML(track.artist)}${track.album ? " • " + escapeHTML(track.album) : ""}
        </span>
        <span class="track-source">${sourceLabel}</span>
      </button>

      ${playing ? '<span class="track-playing-dot"></span>' : ""}

      <button class="track-more" data-more-track="${escapeAttr(track.id)}" aria-label="More options">⋮</button>
    </div>`;
}

function attachTrackEvents(container) {
  container.querySelectorAll("[data-play-track]").forEach(button => {
    button.addEventListener("click", () => playTrack(button.dataset.playTrack));
  });

  container.querySelectorAll("[data-more-track]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      openContextSheet(button.dataset.moreTrack);
    });
  });
}



$("visualizerBtn").addEventListener("click", () => {
  const visualizer = $("visualizer");

  visualizer.classList.toggle("visual-hidden");

  const isHidden = visualizer.classList.contains("visual-hidden");

  $("visualizerBtn").classList.toggle("active", !isHidden);
  
$("npArtShell").classList.toggle("rotating", isPlaying);


  showToast(isHidden ? "Visualizer hidden" : "Visualizer enabled");
});

/* -------------------- QUICK ACTIONS -------------------- */

function handleQuickAction(action) {
  switch (action) {
    case "history":
      showPage("homePage");
      renderRecent();
      document.querySelector(".content-section")?.scrollIntoView({ behavior: "smooth" });
      break;

    case "favorites":
      showPage("libraryPage");
      renderFavoritesLibrary();
      break;

    case "shuffle": {
      if (!tracks.length) {
        showToast("Add music first.");
        return;
      }

      shuffleEnabled = true;
      updatePlayerUI();

      const random = tracks[Math.floor(Math.random() * tracks.length)];
      playTrack(random.id);
      saveSettings();
      break;
    }

    case "albums":
    case "artists":
      showPage("libraryPage");

      document.querySelectorAll("[data-library-tab]").forEach(button => {
        button.classList.toggle("active", button.dataset.libraryTab === action);
      });

      renderLibraryTab(action);
      break;
  }
}

function renderFavoritesLibrary() {
  const container = $("libraryContent");
  if (!container) return;

  const favorites = tracks.filter(track => track.favorite);

  if (!favorites.length) {
    container.innerHTML = `
      <div class="empty-small">
        <span>♡</span>
        <p>You haven't added any favorites yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="track-list">${favorites.map(trackHTML).join("")}</div>`;
  attachTrackEvents(container);
}

/* -------------------- PAGES / SHEETS / MODALS -------------------- */

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".nav-item[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openSourceSheet() {
  openSheet("sourceSheet");
}

function openSheet(id) {
  closeAllSheets();
  $(id)?.classList.add("open");
}

function closeAllSheets() {
  document.querySelectorAll(".bottom-sheet").forEach(sheet => {
    sheet.classList.remove("open");
  });
}

function openModal(id) {
  closeAllModals();
  $(id)?.classList.add("open");
}

function closeModal(id) {
  $(id)?.classList.remove("open");
}

function closeAllModals() {
  document.querySelectorAll(".modal-backdrop").forEach(modal => {
    modal.classList.remove("open");
  });
}

/* -------------------- SLEEP TIMER -------------------- */

function setSleepTimer(minutes) {
  cancelSleepTimer();

  if (!Number.isFinite(minutes) || minutes <= 0) return;

  sleepTimer = minutes;
  sleepTimeout = setTimeout(() => {
    audio.pause();
    sleepTimer = null;
    sleepTimeout = null;
    showToast("Sleep timer stopped playback.");
  }, minutes * 60 * 1000);

  showToast(`Sleep timer: ${minutes} minutes`);
}

function cancelSleepTimer() {
  if (sleepTimeout) clearTimeout(sleepTimeout);

  sleepTimeout = null;
  sleepTimer = null;
  showToast("Sleep timer cancelled");
}

/* -------------------- SETTINGS -------------------- */

async function showSettings() {
  let storageMarkup = "Unavailable";

  if (navigator.storage?.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();

      const usedGB = (usage / (1024 ** 3)).toFixed(2);
      const totalGB = (quota / (1024 ** 3)).toFixed(1);
      const remainingGB = Math.max(0, (quota - usage) / (1024 ** 3)).toFixed(2);

      storageMarkup =
        `${usedGB} GB of ${totalGB} GB used • ` +
        `<span class="storage-left-red">${remainingGB} GB left</span>`;
    } catch {}
  }

  const localCount = tracks.filter(track => track.sourceType === "local").length;
  const remoteCount = tracks.length - localCount;

  if ($("settingsStatsText")) {
    $("settingsStatsText").textContent =
      `${tracks.length} tracks total (${localCount} local, ${remoteCount} remote)`;
  }

  if ($("settingsStorageText")) {
    $("settingsStorageText").innerHTML = storageMarkup;
  }

  openSheet("settingsSheet");
}

/* -------------------- MEDIA SESSION -------------------- */

function updateMediaSession(track) {
  if (!("mediaSession" in navigator) || !track) return;

  try {
    const artwork = getArtworkUrl(track);

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: [{
        src: artwork,
        sizes: "512x512",
        type: "image/png"
      }]
    });

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  } catch {}
}

/* -------------------- AUDIO ERRORS -------------------- */

function handleAudioError() {
  if (!currentTrackId) return;
  showToast("Audio could not be loaded. Check the file or stream URL.");
}

/* -------------------- RESTORE PLAYBACK -------------------- */

async function restorePlaybackState() {
  try {
    const settings = await dbGet(STORE_SETTINGS, "playback");
    if (!settings) return;

    queue = Array.isArray(settings.queue) ? settings.queue : [];
    queue = queue.filter(id => tracks.some(track => track.id === id));

    shuffleEnabled = !!settings.shuffleEnabled;
    repeatMode = ["off", "all", "one"].includes(settings.repeatMode)
      ? settings.repeatMode
      : "off";

    const track = tracks.find(item => item.id === settings.currentTrackId);
    if (!track) {
      updatePlayerUI();
      return;
    }

    currentTrackId = track.id;
    queueIndex = queue.indexOf(track.id);

    if (track.sourceType === "local" && track.blob) {
      currentObjectUrl = URL.createObjectURL(track.blob);
      audio.src = currentObjectUrl;
    } else if (track.url) {
      audio.src = track.url;
    } else {
      updatePlayerUI();
      return;
    }

    const position = Number(settings.position) || 0;

    if (audio.readyState >= 1) {
      audio.currentTime = Math.min(position, audio.duration || position);
    } else {
      audio._restorePosition = position;
    }

    isPlaying = false;
    updatePlayerUI();
    updateMediaSession(track);
  } catch (error) {
    console.warn("Playback restoration failed:", error);
  }
}

/* -------------------- HELPERS -------------------- */

function uniqueAlbums(items) {
  return [...new Set(items.map(track => track.album).filter(Boolean))];
}

function uniqueArtists(items) {
  return [...new Set(items.map(track => track.artist).filter(Boolean))];
}

function libraryEmptyHTML() {
  return `
    <div class="empty-small">
      <span>♫</span>
      <p>Your library is empty.<br>Add music to start listening.</p>
    </div>`;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHTML(value);
}

/* -------------------- TOAST -------------------- */

function showToast(message) {
  if (!$("toast") || !$("toastText")) return;

  $("toastText").textContent = message;
  $("toast").classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    $("toast")?.classList.remove("show");
  }, 2500);
}

/* -------------------- DEFAULT ARTWORK -------------------- */

function createDefaultArtwork() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg"
         width="600" height="600" viewBox="0 0 600 600">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#15284f"/>
          <stop offset="55%" stop-color="#0b1224"/>
          <stop offset="100%" stop-color="#03050a"/>
        </linearGradient>
        <radialGradient id="glow">
          <stop offset="0%" stop-color="#789bff" stop-opacity=".8"/>
          <stop offset="100%" stop-color="#789bff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="600" height="600" fill="url(#bg)"/>
      <circle cx="300" cy="290" r="230" fill="url(#glow)" opacity=".45"/>
      <circle cx="300" cy="300" r="160" fill="none"
              stroke="#91adff" stroke-opacity=".35" stroke-width="3"/>
      <circle cx="300" cy="300" r="115" fill="#0a1121"
              stroke="#7599ff" stroke-opacity=".5" stroke-width="3"/>
      <path d="M330 220v145a50 50 0 1 1-30-46V180l145-35v45z"
            fill="#8aa8ff"/>
      <text x="300" y="500" text-anchor="middle" fill="#fff"
            fill-opacity=".7" font-family="Arial" font-size="28"
            font-weight="700" letter-spacing="7">LASTMUSIC</text>
    </svg>`;

  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
