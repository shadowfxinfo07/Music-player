/* =========================================================
   LASTMUSIC — CLOUD TRACKS MANIFEST
   ========================================================= */

const CLOUD_BASE_URL = "";

/*
   MP3 path:  /song/filename.mp3
   Cover path: /cover/filename.jpg
*/

const CLOUD_SONG_LIST = `

CLOUD:
1.mp3 | Unakkul Naane | Harris Jayaraj | 1.jpg

2.mp3 | Timi Nacha Na | Wangden Sherpa | 2.jpg

3.mp3 | Ambarsariya | Sona Mohapatra | 3.jpg

4.mp3 | Her | JVKE | 4.jpg

5.mp3 | Golden Brown | The Stranglers | 5.jpg

6.mp3 | Zalimaa | Arijit Singh | 6.jpg

7.mp3 | Samjhawan | Arijit Singh | 7.jpg

8.mp3 | Rakhlo tum chupake | Arpit Bala | 8.jpg

9.mp3 | Taare | Saswat Balan, Farak | 9.jpg

10.mp3 | Headlights (feat. KIDDO) | Alok, Alan Walker, KIDDO | 10.jpg

11.mp3 | Sunday | Aditya A, Naalayak | 11.jpg

12.mp3 | First Class | Arijit Singh | 12.jpg
`;

/* Automatically generates cloud tracks */

window.CLOUD_SONGS = (function() {
  
  const lines = CLOUD_SONG_LIST
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
  
  const result = [];
  let currentAlbum = "Cloud Collection";
  
  // Build correct folder URLs
  function getCloudUrl(folder, fileName) {
    const base = CLOUD_BASE_URL.replace(/\/+$/, "");
    const encodedFileName = fileName
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    
    return `${base}/${folder}/${encodedFileName}`;
  }
  
  lines.forEach((line, index) => {
    
    // Album header
    if (line.endsWith(":")) {
      currentAlbum = line.slice(0, -1).trim();
      return;
    }
    
    const parts = line.split("|").map(p => p.trim());
    
    const fileName = parts[0];
    
    // Default title
    const defaultTitle = fileName
      .replace(/\.[^/.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim();
    
    const title = parts[1] || defaultTitle;
    const artist = parts[2] || "Unknown Artist";
    
    let artworkUrl = parts[3] || null;
    
    // Cover image URL
    if (artworkUrl) {
      if (
        !artworkUrl.startsWith("http://") &&
        !artworkUrl.startsWith("https://")
      ) {
        artworkUrl = getCloudUrl("./cover", artworkUrl);
      }
    }
    
    // Song URL
    const songUrl = getCloudUrl("./song", fileName);
    
    result.push({
      
      id: "cloud_" + index + "_" +
        fileName.replace(/[^a-zA-Z0-9]/g, "_"),
      
      sourceType: "cloud",
      
      url: songUrl,
      originalUrl: songUrl,
      
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
