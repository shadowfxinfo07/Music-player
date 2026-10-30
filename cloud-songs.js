/* =========================================================
   LASTMUSIC — CLOUD TRACKS MANIFEST
   
   Format Options:
   1) filename.mp3
   2) filename.mp3 | Song Title | Artist Name
   3) filename.mp3 | Song Title | Artist Name | cover.jpg (or image URL)
   ========================================================= */

const CLOUD_BASE_URL = "";

const CLOUD_SONG_LIST = `

CLOUD:
Unakkul Naane.mp3 | Unakkul Naane | Harris Jayaraj | 1.jpg

2.mp3 | Timi Nacha Na | Wangden Sherpa | 2.jpg

3.mp3 | Ambarsariya | Sona Mohapatra | 3.jpg

4.mp3 | Her | JVKE | 4.jpg

5.mp3 | Golden Brown | the stranglers | 5.jpg

6.mp3 | Zalimaa | Arijit Singh | 6.jpg

7.mp3 | Samjhawan | Arijit Singh | 7.jpg

8.mp3 | Rakhlo tum chupake | Arpit Bala | 8.jpg

9.mp3 | Taare | Saswat Balan, Farak | 9.jpg

10.mp3 | Headlights (feat. KIDDO) | Alok, Alan Walker, KIDDO | 10.jpg

11.mp3 | Sunday | Aditya A, Naalayak | 11.jpg
`;

/* Parser runs automatically — no manual edits needed below */
window.CLOUD_SONGS = (function () {
  const lines = CLOUD_SONG_LIST.split("\n").map(l => l.trim()).filter(Boolean);
  const result = [];
  let currentAlbum = "Cloud Collection";

  lines.forEach((line, index) => {
    // Check if line is an album header
    if (line.endsWith(":")) {
      currentAlbum = line.slice(0, -1).trim();
      return;
    }

    // Split by "|" to get individual details
    const parts = line.split("|").map(p => p.trim());
    const fileName = parts[0];

    // Fallback title from filename if not specified
    const defaultTitle = fileName
      .replace(/\.[^/.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim();

    const title = parts[1] || defaultTitle;
    const artist = parts[2] || "Unknown Artist";
    let artworkUrl = parts[3] || null;

    // Prepend base URL if artwork is a local relative image file (not an external https link)
    if (artworkUrl && !artworkUrl.startsWith("http://") && !artworkUrl.startsWith("https://")) {
      artworkUrl = CLOUD_BASE_URL + artworkUrl;
    }

    result.push({
      id: "cloud_" + index + "_" + fileName.replace(/[^a-zA-Z0-9]/g, "_"),
      sourceType: "cloud",
      url: CLOUD_BASE_URL + fileName,
      originalUrl: CLOUD_BASE_URL + fileName,
      title: title,
      artist: artist,
      album: currentAlbum,
      artworkUrl: artworkUrl,
      blob: null,
      favorite: false,
      playCount: 0,
      lastPlayed: 0,
      createdAt: 0
    });
  });

  return result;
})();
