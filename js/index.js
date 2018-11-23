// Initialize Demo
let JSSDKDemo = null;

/** Check whether or not the demo is running on a supported browser */
const browserCheck = () => {
  const isChrome = !!window.chrome && !!window.chrome.webstore;
  const isFirefox = typeof InstallTrigger !== "undefined";
  const isOpera = (!!window.opr && !!opr.addons) || !!window.opera || navigator.userAgent.indexOf(" OPR/") >= 0;
  const isEdge = navigator.userAgent.indexOf("Edge") >= 0;
  return (isChrome || isFirefox || isOpera || isEdge);
};

$(document).ready(() => {
  JSSDKDemo = new Demo();
  if (browserCheck()) {
    JSSDKDemo.start();
  } else {
    JSSDKDemo.createAlert("incompatible-browser", "It appears that you are using an unsupported browser. Please try this demo on an updated version of Chrome, Firefox, Opera or Edge.");
  }
});

function Demo() {
  const self = this;
  // Use self inside of methods to ensure that the Demo object is referenced when calling public members

  // These are the states that the demo can be in
  this.States = {
    LOADING:"LOADING",
    SEARCHING:"SEARCHING",
    RECORDING:"RECORDING",
    PLAYBACK:"PLAYBACK"
  };
  let state = self.States.LOADING; // Start the demo in the LOADING STATE.

  // Internal State variables

  // Temporarily store videos after promises fire
  let initial_videos = [];

  // Used to prevent the video from losing its state when dragging occurs
  let playing_swap = false;
  // Interval tracking variable.
  let cursor_interval = null;

  // Determines if the buffer should continue
  let video_resumed = false;

  // Internal state for the detector
  let time_buffering_ms = 0;
  let frames_since_last_face = 0;
  const face_alert_threshold = 20;
  const alert_transition_delay_in = 300;
  const alert_transition_delay_out = 175;
  let face_visible = true;
  let detector = null;

  /* This API key only works on the affectiva.github.io domain.
   * Please create your own key by following the instructions from
   * Google here: https://developers.google.com/youtube/registering_an_application#Create_API_Keys */
  let API_KEY = "AIzaSyCLj9zaQKKgRq7CLohJBlJ_eHVENwh-tOE";

  let player = AsyncPlayer();
  let graph = new Graph("#svg-curve");
  let video_ids = ["z63KGZE4rnM"];

  /** ==============================================================
   *                      Pubilc Methods
   *  ============================================================== */

  // /** Make the state of the Demo read only. */
  // this.state = () => state;

  /** Start the Demo, it will begin loading all of the necesary functions. */
  this.start = () => {
    return Promise
      .all([loadYTPlayer(),loadDetector(), loadExamples(video_ids)])
      .then(() => {
        transitionToSearching();
      })
      .catch((message) => {
        showMessage(message);
      });
  };

  /** Creates an alert that is displayed to the user.
   * @param {string} id - Id of the html object to cast the alert to
   * @param {string} text - text of the alert to show to the user. */
  this.createAlert = (id, text) => {
    $("#lightbox").fadeIn(alert_transition_delay_in);
    $("<div></div>", {
      id: id,
      class: "alert alert-danger",
      display: "none",
      text: text,
    }).appendTo("#lightbox");
    $("#" + id).css({"text-align": "center", "z-index": 2});
    $("#" + id).fadeIn(alert_transition_delay_in);
  };

  /** ==============================================================
   *   Load - methods associated with the LOADING phase
   *  ============================================================== */

  /** Promise factory to load the YT Player and bind the relevant callbacks. */
  const loadYTPlayer = () => {
    return new Promise((resolve, reject) => {
      player("load", null, (message, data) => {
        if (message === "loaded") {
          resolve();
        } else {
          reject(message);
        }
      });
    });
  };

  const showErrorRow = () => {
    $("#error-row").removeClass("d-none");
    $("#error-row").removeClass("d-flex");
  };

  /** Promise factory to load the Detector and bid the relevant callbacks. */
  const loadDetector = () => {
    return new Promise((resolve, reject) => {
      let facevideo_node = document.getElementById("facevideo-node");
      detector = new affdex.CameraDetector(facevideo_node);
      detector.detectAllEmotions();

      if (detector && !detector.isRunning) {
        detector.start();
      }
      detector.addEventListener("onWebcamConnectSuccess", () => {
        $("#starting-message").hide();
        showMessage("msg-starting-webcam");
      });
      detector.addEventListener("onWebcamConnectFailure", () => {
        stopLoading();
        showErrorRow();
        reject("msg-webcam-failure");
      });
      detector.addEventListener("onInitializeSuccess", () => {
        resolve();
      });
      detector.addEventListener("onImageResultsSuccess", (faces, img, timestamp) => {
        if (state === self.States.RECORDING && video_resumed) {
          // account for time spent buffering
          const fake_timestamp = getCurrentTimeAdjusted();

          if (frames_since_last_face > face_alert_threshold && face_visible) {
            face_visible = false;
            self.createAlert("no-face", "No face was detected. Please re-position your face and/or webcam.");
          }
          if (faces.length > 0) {
            if (!face_visible) {
              face_visible = true;
              fadeAndRemove("#no-face");
            }
            frames_since_last_face = 0;
            graph.updatePlot(faces[0].emotions, fake_timestamp);
          } else {
            frames_since_last_face++;
            graph.noData(fake_timestamp);
          }
        }
      });
      const face_video = $("#facevideo-node video")[0];
      face_video.addEventListener("playing", () => {
        showMessage("msg-detector-status");
        $("#facevideo-node").hide();
      });
    });
  };

  /** Make a request to load example video data to the `initial_videos` array.
   * @param {string[]} video_ids - list of ids for each of the videos to get. */
  const loadExamples = (video_ids) => {
    let promises = [];
    video_ids.forEach((value) => {
      const url = "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=" + value + "&key=" + API_KEY;
      promises.push(
        httpGetAsync(url)
          .then(addVideoToSuggested(value))
          .catch(ignore)
      );
    });

    return Promise.all(promises);
  };

  /** Take a video ID, and return a function that takes a XMLHttpResponse and adds it to our initial videos to load. */
  const addVideoToSuggested = (value) => (results) => {
    if (results.items.length > 0) {
      const title = results.items[0].snippet.title;
      //each entry in the initial videos array will have a video_id and a title.
      initial_videos.push({
        title:title,
        id:value
      });
    }
  };

  /** ==============================================================
   *   Search - methods associated with the SEARCHING phase
   *  ============================================================== */

  /** Transition the page into the SEARCHING state. */
  const transitionToSearching = () => {
    // Assign relevant handlers to buttons
    $("#btn-start").click(startButtonClicked);
    // add click functionality to enter button
    $("#start-form").keyup((event) => {
      if (event.keyCode === 13 || event.which === 13) {
        $("#btn-start").click();
      }
    });
    stopLoading();
    startSearch();

    state = self.States.SEARCHING;
  };

  /** Remove the loading element from the view */
  const stopLoading = () => {
    $("#loading-row").addClass("d-none").removeClass("d-flex");

  };

  const startSearch = () => {
    $("#demo-setup").addClass("d-flex").removeClass("d-none");
    // Render the instructions
    showMessage("instructions");
    // Render the Youtube Videos
    populateExamples();
  };

  /** Set ordering of initial videos to be in the same order as the video ids list. */
  const sortVideos = () => {
    let ordering = [];
    // Use a selection sort. Efficiency is not a concern given the low input size.
    video_ids.forEach((value) => {
      initial_videos.forEach((video) => {
        if (video.id === value) {
          ordering.push(video);
        }
      });
    });

    initial_videos = ordering;

  };

  /** Render an initial box of videos that to show the user. */
  const populateExamples = () => {

    sortVideos();

    const example_container = $("#example-container");

    // list of lists for how we want to orient the examples, depending on the # of examples we have
    // We will have breakpoints in the order xs, sm, md, lg, xl
    const breakpoints = [
      [12, 6, 6, 4, 4], // < 4
      [12, 6, 6, 6, 6], // = 4 (We want a special behavior for this sweet spot),
      [12, 6, 6, 4, 4]  // > 4
    ];

    const bp = (initial_videos.length > 4) ? breakpoints[2] : ((initial_videos.length === 4) ? breakpoints[1] : breakpoints[0]);

    initial_videos.forEach((video, index) => {
      const thumbnail_url = "https://i.ytimg.com/vi/" + video.id + "/mqdefault.jpg";

      let JQVideoColumn = $(`<div class='col-${bp[0]} col-sm-${bp[1]} col-md-${bp[2]} col-lg-${bp[3]} col-xl-${bp[4]}'></div>`);
      let JQVideoNode =  $("<div class='example card m-1'></div>");

      JQVideoColumn.appendTo(example_container);
      JQVideoNode.appendTo(JQVideoColumn);

      JQVideoNode[0].style.backgroundImage = "url(" + thumbnail_url + ")";
      // Give it the click handler
      JQVideoNode.click({ id: video.id }, onVideoClick);

      JQVideoNode.hover(() => {
        JQVideoNode[0].style.backgroundBlendMode = "overlay";
        JQVideoNode.html("<p class='video-text'>" + video.title + "</p>");
      }, () => {
        JQVideoNode[0].style.backgroundBlendMode = "initial";
        JQVideoNode.html("");
      });

    });
  };

  /** Initialize the transition to the next state. */
  const onVideoClick = (event) => {
    if (state === self.States.SEARCHING) {
      const video_id = event.data.id;
      if (typeof video_id !== "undefined") {
        transitionToRecording(video_id);
      }
    }
  };

  /** Perform search after start button clicked. */
  const startButtonClicked = (cb) => {
    $(".demo-message").hide();
    let video_id;
    if (state === self.States.SEARCHING) {

      const blob = document.getElementById("start-form").value;

      if (blob === "" || blob.includes("http://") || blob.includes("https://")) { // treat as URL
        video_id = blob.split("v=")[1] || "";
        const ampersandPosition = video_id.indexOf("&");
        if (ampersandPosition !== -1) {
          video_id = video_id.substring(0, ampersandPosition);
        }
        transitionToRecording(video_id);
      } else { // treat as search
        const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&key=" + API_KEY + "&maxResults=10&safeSearch=strict&q=" + blob;
        httpGetAsync(url)
          .then(addToSearchResults)
          .catch(ignore)
          .then(cb);
      }
    }
  };

  /** Takes a string of JSON, and adds the results to the view.
   * @param {string} text - String that represents JSON data */
  const addToSearchResults = (results) => {
    $("#search-results").empty();
    $("#search-results").show();
    const list = results.items;

    // add results
    list.forEach((val) => {
      const v = val;
      const s = v.snippet;
      const id = v.id.videoId;
      let result = document.createElement("div");
      result.className = "list-group-item";
      result.id = id;
      result.innerHTML =
      `<div class="row">
          <div class="col-md-auto"><img class="img-fluid" src="${s.thumbnails.medium.url}" style="margin-right:15px"></div>
          <div class="col"><h3>${s.title}</h3><p>${s.description}</p></div>
        </div>`;
      $("#search-results").append(result);
      $("#"+id).click({id: id}, onVideoClick);
    });

    // show a message for when no videos were found
    const num_videos = results.pageInfo.totalResults;
    if (num_videos === 0) {
      let message = document.createElement("div");
      message.className = "list-group-item";
      message.innerHTML = "<p>No results were found.</p>";
      $("#search-results").append(message);
    }
  };

  /** ==============================================================
   *   Record - methods associated with the RECORDING phase
   *  ============================================================== */

  /** Transition the page into the RECORDING state.
   * @param {string} video_id - youtube video id for the video to start playing */
  const transitionToRecording = (video_id) => {
    // Remove any demo messages that were received
    $(".demo-message").hide();


    // start the detector ("The detector only starts graphing when in the RECORDING phase")
    player("play", video_id, (message, data) => {
      if (message === "video start") {
        loadGraphButtons();
        state = self.States.RECORDING;
        showGraph(data.start_time, data.video_duration_ms,data.video_duration_sec);
        video_resumed = true;

      } else if (message ==="short video") {
        showMessage("msg-short-video");

      } else if (message ==="buffer finished") {
        // Tell the detector to start recording
        video_resumed = true;
        time_buffering_ms += data;

      } else if (message === "buffer started") {
        // Tell the detector to stop recording
        video_resumed = false;

      } else if (message ==="ended") {
        video_resumed = false;
        if (state === self.States.PLAYBACK) {
          graph.translateCursor(0);
        } else {
          transitionToPlayback();
        }
        player("seek",0);
        player("pause");

      } else if (message ==="network fail") {
        video_resumed = false;
        detector.stop();
        noInternet();

      } else if (message ==="error") {
        showMessage("msg-bad-url");
      }
    });
  };

  /** Show the graph that was loaded earlier. */
  const showGraph = (start_time, video_duration_ms, video_duration_sec) => {
    // take care of gap at beginning
    $("#demo-setup").removeClass("d-flex");
    $("#demo-setup").fadeOut("fast", () => {
      $("#video-container").addClass("d-flex");
      graph
        .initPlot()
        .setXScale(start_time, video_duration_ms)
        .updatePlot({
          "joy": 0,
          "anger": 0,
          "disgust": 0,
          "contempt": 0,
          "surprise": 0
        }, start_time)
        .configureForPlayback(video_duration_sec);
    });
  };

  /** Load and bind handlers for the various emotion buttons. */
  const loadGraphButtons = () => {
    // Register click handlers for each emotion button
    $("#all").click(graph.allButtonClickHandler);
    graph.emotions.forEach((val) => {
      $("#"+val).click(graph.EmotionButtonClickHandler(val));
    });
  };

  /** ==============================================================
   *   Playback - methods associated with the PLAYBACK phase
   *  ============================================================== */

  // /** Transition the page into the PLAYBACK state. */
  // const transitionToPlayback = () => {
  //   state = self.States.PLAYBACK;
  //   detector.stop();
  //
  //   $(".alert").hide();
  //
  //   // focus on message
  //   $("#lightbox").fadeIn(750, () => {
  //     // start playback
  //     initializePlayback();
  //     $("#player").css("pointer-events", "");
  //     $("#play-again").fadeIn(500, () => {
  //       $("#lightbox").one("click", allowPlayback);
  //     });
  //     $("#btn-play-again").one("click", allowPlayback);
  //   });
  // };
  // /** Start the playback, by adding a cursor that tracks the video. */
  // const initializePlayback = () => {
  //   let cursor = graph.initializeCursor();
  //   trackVideo();
  //   // Set Drag Handlers
  //   cursor
  //     .call(d3.drag()
  //       .on("drag", dragHandler)
  //       .on("start",dragStartHandler)
  //       .on("end",  dragEndHandler)
  //     );
  //   // Handle clicks to a particular moment in time
  //   graph
  //     .getCurveBox()
  //     .on("click", graphClickHandler);
  // };
  //
  // /** Handle the `try again`, and `got it` button transition. */
  // const allowPlayback = () => {
  //   $("#lightbox").fadeOut(500);
  //
  //   let play_again_button = $("#btn-play-again");
  //
  //   play_again_button.fadeOut(500,() => {
  //     play_again_button.replaceWith(() => {
  //       return $("<button id='btn-play-again' class='btn btn-primary'>Try again</button>").fadeIn(500, () => {
  //         setSpaceBarPlayBehvaior();
  //         $("#btn-play-again").one("click", () => {
  //           window.location.reload(false);
  //         });
  //       });
  //     });
  //   });
  // };
  //
  // /** Add listeners for the spacebar, to allow controls for the video in playback. */
  // const setSpaceBarPlayBehvaior = () => {
  //   document.onkeypress = (event) => {
  //     if ((event || window.event).charCode == 32) {
  //       if (player("getPlayingState")) {
  //         player("pause");
  //       } else {
  //         player("resume");
  //       }
  //     }
  //   };
  // };
  //
  // /** Handler for `drag` event. */
  // const dragHandler = () => {
  //   const x_coord = graph.clipX(d3.event.x);
  //   const playback_time = graph.playbackFromX(x_coord);
  //   graph.translateCursor(x_coord);
  //   player("seek", playback_time);
  // };
  //
  // /** Handler for `dragstart` event. */
  // const dragStartHandler = () => {
  //   if (player("getPlayingState")) {
  //     clearInterval(cursor_interval);
  //     // Store the state of the player and pause it.
  //     playing_swap = true;
  //     player("pause");
  //   }
  //   graph.setMousePointerDragging();
  // };
  //
  // /** Handler for `dragend` event. */
  // const dragEndHandler = () => {
  //   if (playing_swap) {
  //     player("resume");
  //     playing_swap = false; //reset it to false after use
  //
  //     player("setPlayingState", true);
  //     trackVideo();
  //   }
  //   graph.setMousePointerUndragging();
  // };
  //
  // /** Handler for `click` event on graph. */
  // const graphClickHandler = function() {
  //   const x_click = graph.clipX(d3.mouse(this)[0]);
  //   const playback_time = graph.playbackFromX(x_click);
  //
  //   if (player("getPlayingState")) {
  //     clearInterval(cursor_interval);
  //     graph.translateCursor(x_click);
  //     player("seek", playback_time);
  //     trackVideo();
  //   } else {
  //     graph.translateCursor(x_click);
  //     player("seek", playback_time);
  //
  //   }
  // };
  //
  // /** Sets an interval for the graph cursor, such that it tracks the video's playing. */
  // const trackVideo = () => {
  //   cursor_interval = setInterval(() => {
  //     if (player("getPlayingState")) {
  //       const x_coord = graph.playbackToX(player("getCurrentTime"));
  //       graph.translateCursor(x_coord);
  //     }
  //   }, 50);
  // };
  //
  // /** ==============================================================
  //  *                      UTILITIES AND ALERTS
  //  *  ============================================================== */

  /** Ignores it's input and returns null. Useful for ignore promise failures */
  const ignore = () => {};

  /** Creates a promise that resolves a GET request when the server returns a response status of 200, fails otherwise.
   * @param {string} urlString - URL of the GET request. */
  const httpGetAsync = (urlString) => {
    return new Promise((resolve, reject) => {
      $.ajax({
        url:urlString,
        method:"GET",
        success: ( data, textStatus, jqXHR ) => { resolve(data); },
        failure: ( jqXHR, textStatus, errorThrown) =>{ reject(errorThrown); }
      });
    });
  };

  /** Show a demo-message with the proper id
   * @param {string} id - id of element to show on screen. */
  const showMessage = (id) => {
    $(".demo-message").hide();
    $(document.getElementById(id)).fadeIn("fast");
  };

  /** Returns the Adjusted time of the video. */
  const getCurrentTimeAdjusted = () => {
    return Date.now() - time_buffering_ms;
  };

  /** Remove alerts created by the `createAlert` function.
   * @param {string} id - id of element to remove from the view. */
  const fadeAndRemove = (id) => {
    let removeObj = $(id);

    removeObj.fadeOut(alert_transition_delay_out, () => {
      removeObj.remove();
    });
    $("#lightbox").fadeOut(alert_transition_delay_out);
  };

  /** Create an alert that tells the user that there is no internet connection. */
  const noInternet = () => {
    $(".alert").hide();
    self.createAlert("terminated", "It appears that you aren't connected to the Internet anymore. Please refresh the page and try again.");
  };
}
