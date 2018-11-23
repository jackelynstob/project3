/** Asynchronous Player is a closure that is configurable with callbacks and signals.
 */
function AsyncPlayer() {
  let player = null;
  const VIDEO_VOLUME = 50;
  const VIDEO_LENGTH_THRESHOLD = 5;

  // These Invoker act like containers around the event handlers, because the handler must change everytime it is played with a new callback.
  let invokerState = (e) => current_state_change_handle(e);
  let invokerError = (e) => current_error_handle(e);

  //Event Handlers
  let current_state_change_handle = (e) => {};
  let current_error_handle = (e) => {};

  let buffer_start_time_ms = 0;
  let video_duration_sec = 0;
  let video_duration_ms = 0;
  let start_time = 0;
  let playing = false;

  let buffer_lock = false;
  let has_ended   = false;
  let video_started = false;

  const initializeYouTubePlayer = (cb) => () => {
    player = new YT.Player("player", {
      playerVars: {
        "controls": 0,
        "iv_load_policy": 3,
        "rel": 0,
        "showinfo": 0
      },
      events: {
        "onError": invokerError,
        "onStateChange": invokerState
      }
    });
    cb("loaded");
  };

  const onPlayerError = (cb) => (e) => {
    player.stopVideo();
    start_time = 0;
    cb("error", null);
  };

  const onPlayerStateChange = (cb) => (event) => {
    const status = event.data;

    // Expose the playing state to the cursor.
    if (status === YT.PlayerState.PLAYING) {
      playing = true;
    } else {
      playing = false;
    }

    if (status === YT.PlayerState.PLAYING) {
      // Loaded a video successfully
      const video_duration_seconds = player.getDuration();
      // Check if the video matches length:
      if (video_duration_seconds < VIDEO_LENGTH_THRESHOLD) {
        player.stopVideo();
        cb("short video", null);
        return;
      } else if (buffer_lock && video_started) {
        // Just came from a buffer. return time difference
        var buffer_time = Date.now() - buffer_start_time_ms;
        buffer_lock = false;
        cb("buffer finished", buffer_time);
        return;
      } else if (!video_started){
        // There is a valid video started signal
        video_started = true;
        start_time = Date.now();
        player.setVolume(VIDEO_VOLUME);
        video_duration_ms = video_duration_seconds * 1000;
        video_duration_sec = video_duration_seconds;
        cb("video start", {
          video_duration_ms:video_duration_ms,
          start_time: start_time,
          video_duration_sec:video_duration_sec
        });
      } else {
        cb("resume", null);
      }
    } else if (status === YT.PlayerState.ENDED) {
      has_ended = true;
      cb("ended", null);
    } else if (status === YT.PlayerState.PAUSED) {
      if (!has_ended) {
        cb("error", "Tried to pause video when video hadn't ended.");
      } else {
        cb("paused", null);
      }
    } else if (status === YT.PlayerState.CUED) {
      if (video_started && !has_ended) {
        cb("network fail", null);
        player.stopVideo();
      } else if (!video_started) {
        cb("video cued w/out starting", null);
      }
    } else if (status === -1) {
      return;
    } else if (status === YT.PlayerState.BUFFERING) {
      if (video_started) {
        buffer_start_time_ms = Date.now();
        buffer_lock = true;
        cb("buffer started", null);
      }
    } else {
      cb("error", "Unknown Player status: " + status);
    }
  };

  return (message, data=null, cb = (message, data)=>{}) => {
    //Handle Asynchronous messages
    if (message === "load") {
      // Do the asynchronous loading, and notify the cb when finished
      new Promise((resolve, reject) => {
        var tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        var firstScriptTag = document.getElementsByTagName("script")[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        resolve();
      });
      // Defer the resolution of this promise to the initialize callback of the youtube player
      window.onYouTubeIframeAPIReady = initializeYouTubePlayer(cb);
    } else if (message === "play") {

      current_state_change_handle = onPlayerStateChange(cb);
      current_error_handle = onPlayerError(cb);
      player.loadVideoById(data); // assume that data is a video id

    } else if (message === "seek") {
      player.seekTo(data);        // assume that data is a time
      cb("seeked", null);
    } else if (message === "pause"){
      player.pauseVideo();
      cb("paused", null);
    } else if (message === "resume") {
      player.playVideo();
      cb("playing", null);
    }
    // Handle synchronous messages
    if (message === "getVideoDurationSec") {
      return video_duration_sec;
    } else if (message === "getVideoDurationMs") {
      return video_duration_ms;
    } else if (message === "getStartTime") {
      return start_time;
    } else if (message === "getPlayingState") {
      return playing;
    } else if (message === "getCurrentTime") {
      return player.getCurrentTime();
    } else if (message === "setPlayingState") {
      playing = data;
    }
  };
}