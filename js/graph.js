// https://github.com/wbkd/d3-extended
d3.selection.prototype.moveToFront = function() {
  return this.each(function(){
    this.parentNode.appendChild(this);
  });
};

/** Graph Controller
 *  This is an Object that performs the state changes and interfaces with the relevant libraries in order to graph data that is coming to the graph from the detector.
 * @param {string} id - id of the svg curve div object in the DOM
 * @returns {object} - object that represents the graph controller.
 */
function Graph (id) {
  // preserve the internal reference to this object, and get around javascript's wonky `this` behavior.
  let self = this;

  // private members
  const curveBox = d3.select(id);
  let cursor = null;
  let cursor_text = null;
  const colors = ["#2ee65d", "#fc4627", "#ffd000", "#2bb3f7", "#ff69bf"];
  let selected_emotion = "all";
  let svg_width = 720;
  let x_scale = d3.scaleLinear().domain([0, 0]).range([0, svg_width]);
  let y_scale = d3.scaleLinear().domain([100, 0]).range([2, 248]);
  let time_scale = null;
  let video_cutoff_sec = 0;
  let video_duration_sec = 0;
  const path = d3.line()
    .curve(d3.curveBasis)
    .x((d, i) => x_scale(d[0]))
    .y((d, i) => y_scale(d[1]));

  // For data nulling
  let processed_frames = [[[],[],[],[],[]]];
  let currentCurvesIdx = 0;
  let wasNil = false;
  let gray_boxes = [[]]; // This is an array of intervals that will maintain the timestamps of grayed out data.
  let last_box = null;
  // public members
  this.emotions = ["joy", "anger", "disgust", "contempt", "surprise"];
  //private methods

  /** Creates a string that represents the current time of the video.
   * @param {float} time_sec - time in seconds
   * @returns {string} - string formated in correct time. */
  const textTime = (time_sec) => {
    return Math.floor(time_sec / 60) + ":" + ((time_sec % 60 < 10) ? ("0" + time_sec % 60) : time_sec % 60);
  };

  //public methods

  /** Sets the X Scale of the graph.
   * @param {*} start_time - time at which the video starts
   * @param {*} video_duration_ms - time at which the */
  this.setXScale = (start_time, video_duration_ms) => {
    x_scale = d3.scaleLinear().domain([start_time, start_time + video_duration_ms]).range([0, svg_width]);

    return self;
  };

  /** Getter function for the d3 curve element
   *  @returns {object} - div that contains the curve */
  this.getCurveBox = () => {
    return curveBox;
  };

  /** Getter function for the various curves contained in the curve box
   * @returns {object} - returns a d3 selection */
  this.getCurves = () => {
    return curveBox.selectAll("path.curve");
  };

  /** This function takes an emotion, and transitions the currently selected emotion accordingly.
   * @param {string} emotion - name that is associated with the particular emotion that was handled. */
  this.resetSelectedEmotionButton = (emotion) => {
    // If the selected_emotion is not the one that was just clicked, then toggle the current one
    if (selected_emotion !== emotion) {
      $("#" + selected_emotion).removeClass("selected");
      $("#" + emotion).addClass("selected");
      selected_emotion = emotion;
    }

    return self;
  };

  /** Button Handler for the `all` button. */
  this.allButtonClickHandler = () => {
    self
      .resetSelectedEmotionButton("all")
      .getCurves()
      .transition()
      .duration(400)
      .attr("stroke-opacity", 1.0);
  };

  /** Button Handler Generator for the rest of the emotions
   *  Just call `$(button).click(graph.EmotionButtonClickHandler(emotion));` to use
   * @param {string} emotion - name of the emotion to highlight. */
  this.EmotionButtonClickHandler = (emotion) => {
    return () => {
      self
        .resetSelectedEmotionButton(emotion)
        .getCurves()
        .transition()
        .duration(400)
        .attr("stroke-opacity", function(d,i) {
          if (this.id === emotion) {
            return 1.0;
          } else {
            return 0.2;
          }
        });
    };
  };

  /** Adds a singular datum to the graph.
   * @param {string:float} emotionTable - this is a dictionary that maps each emotion to a floating point number
   * @param {float} timestamp - this is the timestamp in the video (effectively the x coordinate). */
  this.addDataPoint = (emotionTable, timestamp) => {
    self.emotions.forEach((val, idx) => {
      processed_frames[currentCurvesIdx][idx].push([timestamp, emotionTable[val]]);
    });
    return self;
  };

  /** Tells graph that there is no data to plot. It will resolve this by finishing the current svg, and creating a new svg */
  this.noData = (timestamp) => {
    if (!wasNil) {
      //Increment current curvesIdx, and initialize some new curves.
      currentCurvesIdx++;

      processed_frames.push([[],[],[],[],[]]);
      gray_boxes.push([x_scale(timestamp)]); // First element is the timestamp that was lost.

      last_box = self
        .getCurveBox()
        .append("rect");
      initLastVoid();

    } else {
      plotLastVoid(timestamp);
    }
    wasNil = true;
  };

  /** updates the plot to have up to date information
   * @param {string:float} emotionTable - this is a dictionary that maps each emotion to a floating point number
   * @param {float} timestamp - this is the timestamp in the video (effectively the x coordinate). */
  this.updatePlot = (emotionTable, timestamp) => {
    if (wasNil) {
      var initial_data = [
        [ [timestamp, emotionTable["joy"]] ], // joy
        [ [timestamp, emotionTable["anger"]] ], // anger
        [ [timestamp, emotionTable["disgust"]] ], // disgust
        [ [timestamp, emotionTable["contempt"]] ], // contempt
        [ [timestamp, emotionTable["surprise"]] ]  // surprise
      ];
      self
        .getCurves()
        .filter(".c"+currentCurvesIdx.toString())
        .data(initial_data)
        .enter()
        .append("svg:path")
        .attr("class", "curve c"+ currentCurvesIdx.toString()) // append c1 c2 c3 whatever, depending on the current svg.
        .attr("id", function(d, i){return self.emotions[i];})
        .attr("d", path)
        .attr("stroke", function(d, i) {return colors[i];})
        .attr("fill", "transparent")
        .attr("stroke-width","2px")
        .attr("stroke-opacity", "1");

      // Now add the graybox to the SVG
      gray_boxes[currentCurvesIdx].push(x_scale(timestamp));
      plotLastVoid(timestamp);
      last_box.moveToFront();
      wasNil = false;
    } else {
      self
        .addDataPoint(emotionTable, timestamp)
        .getCurves()
        .filter(".c"+currentCurvesIdx.toString())
        .data(processed_frames[currentCurvesIdx])   // curves are assigned in index order, this is how d3 works.
        .attr("d", path);

    }
    return self;
  };

  var initLastVoid = () => {
    last_box
      .attr("x", gray_boxes[currentCurvesIdx][0])
      .attr("y", 0)
      .attr("width", 0)
      .attr("height", 250)
      .attr("fill", "#404040");
  };
  var plotLastVoid = (timestamp) => {
    let x1 = gray_boxes[currentCurvesIdx][0];
    let x2 = x_scale(timestamp);
    last_box.attr("width", x2-x1);
  };

  /** Instantiate the plot. zero the data, and set attributes of curves. */
  this.initPlot = () => {

    var initial_data = [
      [ [0, 0] ], // joy
      [ [0, 0] ], // anger
      [ [0, 0] ], // disgust
      [ [0, 0] ], // contempt
      [ [0, 0] ]  // surprise
    ];

    self
      .getCurves()
      .data(initial_data)
      .enter()
      .append("svg:path")
      .attr("class", "curve c"+ currentCurvesIdx.toString()) // append c1 c2 c3 whatever, depending on the current svg.
      .attr("id", function(d, i){return self.emotions[i];})
      .attr("d", path)
      .attr("stroke", function(d, i) {return colors[i];})
      .attr("fill", "transparent")
      .attr("stroke-width","2px")
      .attr("stroke-opacity", "1");


    svg_width = $(id).width();

    return self;
  };

  /** Move the cursor (line) to the relevant x coordinate and render the time location of the cursor
   * @param {number} x_coord - the x_coord to set the cursor to. */
  this.translateCursor = (x_coord) => {
    // translate timeline cursor
    cursor.attr("transform", "translate(" + x_coord + ", 0)");

    // render time
    const time_sec = Math.floor(x_coord / svg_width * video_duration_sec);
    const text = textTime(time_sec);
    cursor_text.text(text);

    // figure out if flip is necessary
    $("#text-width")[0].innerHTML = text;
    const text_width = $("#text-width")[0].clientWidth;
    const flip_at = svg_width - text_width - 5;

    if (x_coord > flip_at) {
      cursor_text.attr("transform", "translate(" + (x_coord - text_width - 10) + ", 0)");
    } else {
      cursor_text.attr("transform", "translate(" + x_coord + ", 0)");
    }

    return self;
  };

  /** returns the time value from the x coordinate.
   * @param {number} x_coord - x coordinate of the pointer location
   * @returns {number} - returns a time from the given x coordinates. */
  this.playbackFromX = (x_coord) => {
    return time_scale.invert(x_coord);
  };

  /** returns the x coordinate from the time value.
   * @param {number} time - returns a time from the given x coordinates
   * @returns {number} - x coordinate of the pointer location
   */
  this.playbackToX = (time) => {
    return time_scale(time);
  };

  /** clips the X coordinate to the correct x.
   * @param {number} x_coord - x coordinate of the pointer location
   * @returns {number} - returns a new x coordinate in the range of the interval. */
  this.clipX = (x_coord) => {
    var playback_time = time_scale.invert(x_coord);
    if (playback_time < 0) {
      return 0;
    } else if (playback_time >= video_cutoff_sec) {
      return time_scale(video_cutoff_sec);
    } else {
      return x_coord;
    }
  };

  /** Sets the mouse pointer to a dragging state */
  this.setMousePointerDragging = () => {
    $("html, .draggable-rect, line.cursor-wide").css({"cursor": "-webkit-grabbing"});
    $("html, .draggable-rect, line.cursor-wide").css({"cursor": "-moz-grabbing"});
    $("html, .draggable-rect, line.cursor-wide").css({"cursor": "grabbing"});
    return self;
  };
  /** Sets the mouse pointer to it's original state */
  this.setMousePointerUndragging = () => {
    $("html").css({"cursor": "default"});
    $(".draggable-rect, line.cursor-wide").css("cursor", "pointer");
    return self;
  };
  /** Initializes the cursor and returns it.
   * @returns {object} - cursor that can then configure callbacks on. */
  this.initializeCursor = () => {
    // Initialize Cursor
    cursor = curveBox.append("svg:g").attr("y1", 0).attr("y2", 250).attr("x1", 0).attr("x2", 10).attr("class", "draggable-group");
    cursor.append("svg:rect").attr("x", -5).attr("y", 0).attr("width", 10).attr("height", 250).attr("class", "draggable-rect");
    cursor.append("svg:line").attr("class", "cursor cursor-wide").attr("y1", 0).attr("y2", 250).attr("x1", 0).attr("x2", 0);
    // Initialize cursor text box for current time
    cursor_text = curveBox.append("svg:text").attr("class", "time video_current_time").attr("y", 20).attr("x", 5).text("0:00");

    return cursor;
  };

  /** Should be called from onPlayerStateChange in the player callback closure. This sets the necesary variables to enable the timestep and scale
   * @param {float} video_duration_sec - the duration of the video in seconds. Used to create a linear time scale. */
  this.configureForPlayback = (video_duration_seconds) => {
    video_duration_sec = video_duration_seconds;
    video_cutoff_sec = Math.floor(video_duration_seconds);
    time_scale = d3.scaleLinear().domain([0, video_duration_seconds]).range([0, svg_width]);
  };
}