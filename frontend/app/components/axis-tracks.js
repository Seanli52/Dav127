import Ember from 'ember';
import { inject as service } from '@ember/service';


import createIntervalTree from 'npm:interval-tree-1d';
import { eltWidthResizable, noShiftKeyfilter } from '../utils/domElements';
import InAxis from './in-axis';
import {  eltId, axisEltId, eltIdAll, axisEltIdClipPath, trackBlockEltIdPrefix, axisTitleColour }  from '../utils/draw/axis';
import { ensureSvgDefs } from '../utils/draw/d3-svg';

/*----------------------------------------------------------------------------*/
/* milliseconds duration of transitions in which feature <rect>-s are drawn / changed.
 * Match with time used by draw-map.js : zoom() and resetZoom() : 750.
 * also @see   dragTransitionTime and axisTickTransitionTime.
 */
const featureTrackTransitionTime = 750;

/** width of track <rect>s */
let trackWidth = 10;
/** track sub-elements < this height (px) are not rendered. */
const subElementThresholdHeight = 5;

/** for devel.  ref comment in @see height() */
let trace_count_NaN = 10;

const dLog = console.debug;

/*------------------------------------------------------------------------*/
/* copied from draw-map.js - will import when that is split */
    /** Setup hover info text over scaffold horizTick-s.
     * @see based on similar configureAxisTitleMenu()
     */
    function  configureHorizTickHover(location)
    {
      // console.log("configureHorizTickHover", location, this, this.outerHTML);
      /** typeof location may also be "number" or "object" - array : syntenyBlocks[x] */
      let text = (location == "string") ? location :  "" + location;
      let node_ = this;
      Ember.$(node_)
        .popover({
          trigger : "click hover",
          sticky: true,
          delay: {show: 200, hide: 3000},
          container: 'div#holder',
          placement : "auto right",
           content : text
        });
    }
/*----------------------------------------------------------------------------*/

/** Configure hover text for tracks. */
function  configureTrackHover(interval)
{
  return configureHorizTickHover.apply(this, [interval.description]);
}
/** Same as configureHorizTickHover(), except for sub-elements,
 * for which the source data, and hence .description, is in interval.data,
 * because the interval tree takes just the interval as input.
 */
function  configureSubTrackHover(interval)
{
  return configureHorizTickHover.apply(this, [(interval.data || interval).description]);
}

/*----------------------------------------------------------------------------*/

/** For d3 .data() key function */
function I(d) { return d; }

/*----------------------------------------------------------------------------*/

/** filter intervalTree : select those intervals which intersect domain.
 * @param sizeThreshold intervals smaller than sizeThreshold are filtered out;
 * undefined means don't filter.
 * @param assignOverlapped  true means assign overlapping tracks in sequence;
 * this is used for Feature tracks, but for sub-elements there is likely to be a
 * sub-element which overlaps all the others, which would place them all in
 * separate layers and missing opportunities to pack more closely.
 *
 * @return {intervals:  array of intervals,
 * layoutWidth : px width allocated for the layered tracks}
 */
function regionOfTree(intervalTree, domain, sizeThreshold, assignOverlapped)
{
  let intervals = [],
  result = {intervals : intervals};
  function visit(interval) {
    if ((sizeThreshold === undefined) || (interval[1] - interval[0] > sizeThreshold))
      intervals.push(interval);
  }
  let subTree;
  if (domain) {
    intervalTree.queryInterval(domain[0], domain[1], visit);
    // Build another tree with just those intervals which intersect domain.
    subTree = createIntervalTree(intervals);
  } else {
    subTree = intervalTree;
    result.intervals = intervalTree.intervals;
  }

  /** for each interval, if it does not have a layer,
   * get list of intervals in subTree it intersects,
   * note the layers of those which already have a layer assigned,
   * give the remainder (starting with the current interval) layers which are not assigned in that group.
   * (this alg is approx, but probably ok;  seems like a bin-packing problem)
   */
  let i1 = subTree.intervals, layers = {}, nextLayer = 0, largestLayer = 0;
  for (let j=0; j<i1.length; j++)
  {
    // could continue if (i1[j].layer)
    let i=i1[j], overlaps = [], layersUsed = [];
    function noteLayers(interval) {
      overlaps.push(interval);
      if (interval.layer !== undefined)
        layersUsed[interval.layer] = true; /* or interval*/
    };
    subTree.queryInterval(i[0], i[1], noteLayers);
    function unusedLayers() {
      let unused = [];
      for (let j3 = 0; j<layersUsed.length; j++)
      {
        if (! layersUsed[j3])
          unused.push(j3);
      }
      return unused;
    }
    /** if layersUsed is empty, then ++lastUsed is 0,  */
    let lastUsed = layersUsed.length-1,
    u =  unusedLayers();
    function chooseNext() {
      let next = u.pop() || ++lastUsed;
      return next;
    }
    /** Assign a layer to one interval.
     * @param o  interval  */
    function assignInterval(o) {
        if (! o.layer)
          o.layer = chooseNext();
    }
    /** Assigninterval layers to remaining intervals in overlaps[].
     */
    function assignRemainder() {
      for (let j2 = 0; j2 < overlaps.length; j2++)
      {
        let o = overlaps[j2];
        assignInterval(o);
      }
    };
    assignInterval(i);
    if (assignOverlapped)
      assignRemainder();
    if (lastUsed > largestLayer)
      largestLayer = lastUsed;
  }
  result.layoutWidth = (largestLayer+1) * trackWidth * 2;

  return result;
}

/** select the g.axis-outer which contains g.axis-use. */
function selectAxis(axisID)
{
  let aS = d3.select("#" + eltId(axisID));
  return aS;
}

function setClipWidth(axisID, width)
{
  let
  aS = selectAxis(axisID),
  cp = aS.select("g.axis-use > clipPath > rect");
  /** If the user has resized to a larger width, don't reduce it.
   * The role of this is to automatically increase the width if layout requires it.
   */
  if (cp.attr("width") < width)
  cp
    .attr("width", width);
  let gh = aS.select("g.axis-use > g.axis-html");
  gh
    .attr("transform", "translate(" + width + ")");
  console.log('setClipWidth', axisID, width, aS.node(), cp.node(), cp.attr("width"),  gh.node());
}

/*----------------------------------------------------------------------------*/

class SubElement {
  constructor(data) {
    this.data = data;
  }
};
/** static, also  member @see getInterval()  */
SubElement.getInterval = function(data) {
  let interval = data.slice(0, 2);
  // perhaps use a WeakMap instead of this
  interval.data = data;
  if (interval[0] > interval[1]) {
    let swap = interval[0];
    interval[0] = interval[1];
    interval[1] = swap;
  }
  return interval;
};
SubElement.prototype.getInterval = function() {
  let interval = SubElement.getInterval(this.data);
  return interval;
};



/*----------------------------------------------------------------------------*/

/* global d3 */

export default InAxis.extend({

  queryParams: service('query-params'),
  urlOptions : Ember.computed.alias('queryParams.urlOptions'),

  className : "tracks",
  
  /** For each viewed block (trackBlocksR), some attributes are kept, until the
   * axis closes.  This state is likely to move to a axis-tracks-block component.
   * So far this contains only a WeakMap for the interval trees of Feature sub-elements (.subEltTree).
   */
  blocks : {},

  /*--------------------------------------------------------------------------*/

  init() {
    this._super(...arguments);

    let trackWidthOption = this.get('urlOptions.trackWidth');
    if (trackWidthOption) {
      dLog('init', 'from urlOptions, setting trackWidth', trackWidthOption, ', was', trackWidth);
      trackWidth = trackWidthOption;
    }
  },

  /*--------------------------------------------------------------------------*/

  actions: {

    selectionChanged: function(selA) {
      console.log("selectionChanged in components/axis-tracks", selA);
      for (let i=0; i<selA.length; i++)
        console.log(selA[i].feature, selA[i].position);
    },

    putContent : function(object, event) {
      console.log("putContent in components/axis-tracks", object, event, event.type, event.target.innerText);
    }

  },

  /*--------------------------------------------------------------------------*/

  didInsertElement() {
    this._super(...arguments);

    console.log("components/axis-tracks didInsertElement()");
    let
      childWidths = this.get('childWidths'),
    axisID = this.get('axisID'),
    width = this.get('layoutWidth');
    dLog('didInsertElement', axisID, width);
    // [min, max] width
    childWidths.set(this.get('className'), [width, width]);

    let svg = d3.selectAll('svg.FeatureMapViewer');
    ensureSvgDefs(svg);
  },

  willDestroyElement() {
    this._super(...arguments);
    console.log("components/axis-tracks willDestroyElement()");
  },

  didRender() {
    console.log("components/axis-tracks didRender()");
  },

  /*--------------------------------------------------------------------------*/

  axis1d : Ember.computed('axis.axis1d', 'axis.axis1d.isDestroying', function () {
    /** this CP could be simply a .alias, but it can get a reference to a axis1d
     * which is being destroyed; probably need a small design change in the
     * component relations. */
    let axis1d = this.get('axis.axis1d');
    if (axis1d && axis1d.isDestroying) {
      console.log('axis1d isDestroying', this);
      axis1d = undefined;
    }
    return axis1d;
  }),
  axisS : Ember.computed.alias('axis.axis'),
  currentPosition : Ember.computed.alias('axis1d.currentPosition'),
  yDomain : Ember.computed.alias('currentPosition.yDomain'),

  /** From the Ember block objects, derive the stack Blocks. */
  trackBlocks : Ember.computed('trackBlocksR.@each.view', function () {
    let trackBlocksR = this.get('trackBlocksR'),
    trackBlocks = trackBlocksR.mapBy('view');
    console.log('trackBlocks', trackBlocksR, trackBlocks);
    return trackBlocks;
  }),

  /*--------------------------------------------------------------------------*/

  /** currently not called because (quoting from axis-2d comment) : axis-2d
   * receives axisStackChanged from draw-map and propagates it as zoomed to its
   * children.
   * In a separate commit this can be connected;  the update is not required -
   * the only effect of stacking would be a change of sizeThreshold, which could
   * be dependent on axis yRange but it is not yet.
   */
  axisStackChanged : function() {
    console.log("axisStackChanged in components/axis-tracks", this);
    // stack change would change the y display range of the axis, and hence the yScale
    this.showResize(true, true /* , yScaleChanged ? */);
  },
  /* Earlier version (prior to feature/progressive) defined zoomed() for InAxis;
   * this is replaced by giving showTrackBlocks() dependency on yDomain and
   * zoomed.
   */

  /*--------------------------------------------------------------------------*/

  showResize : function(widthChanged, heightChanged, yScaleChanged) {
    let tracks = this.get('tracks'),
    resized = {width : widthChanged, height : heightChanged, yScale : yScaleChanged};
    console.log((tracks === undefined) || tracks.length);
    let args = [resized, tracks];
    console.log('showResize args', args);
    if (tracks)
      Ember.run.throttle(this, this.layoutAndDrawTracks, args, 500, true);
  },

  /*--------------------------------------------------------------------------*/

  /** Convert input text to an interval tree.
   * @param tableText text string, TSV, rows separated by \n and/or \r.
   * First row may contain a header with column names, indicated by leading #.
   * Column names "start", "end" and "description" indicate the columns containing those values,
   * otherwise the default columns are 0, 1, 2 respectively.
   * Other columns are appended to the description value of the 
   */
  parseIntervals(tableText)
  {
    let axisName = "1", intervals = {}, intervalNames = new Set();
    let rows = tableText.split(/[\n\r]+/);
    let colIdx = {start : 0, end : 1, description : 2};
    for (let i=0; i<rows.length; i++)
    {
      let col=rows[i].split(/[ \t]+/);
      if ((rows[i].length == 0) || (col.length == 0))
      {
        console.log("empty row", i, rows[i]);
      }
      else if ((i == 0) && (col[0].startsWith("#")))
      {
        col[0] = col[0].substring(1); // trim off the leading #
        colIdx["start"] = col.indexOf("start");
        colIdx["end"] = col.indexOf("end");
        colIdx["description"] = col.indexOf("description");
      }
      else
      {
      let
      // mapChrName = col[0],
      interval = [col[colIdx["start"]], col[colIdx["end"]]],
      description = col[colIdx["description"]];
    for (let ic=0; ic<col.length; ic++)
    {
      if ((ic != colIdx["start"]) && (ic !=colIdx["end"]) && (ic != colIdx["description"]))
      {
        description += "_" + col[ic];
      }
    }
        interval.description = description;
      // let axisName = mapChrName2Axis(mapChrName);
      if (intervals[axisName] === undefined)
        intervals[axisName] = [];
      intervals[axisName].push(interval);
      let intervalName = col[colIdx["start"]] + "_" + col[colIdx["end"]]; //makeIntervalName(mapChrName, [col[1], + col[2]]);
      intervalNames.add(intervalName);
      }
    }
    let result = this.makeTree(intervals, intervalNames);
    return result;
  },
  makeTree(intervals, intervalNames) {
    let intervalTree = {};
    /* input data errors such as [undefined, undefined] in intervals passed to createIntervalTree() can cause
     * e.g. RangeError: Maximum call stack size exceeded in Array.sort().
     */
    d3.keys(intervals).forEach(function (axisName) {
      //Build tree
      intervalTree[axisName] = createIntervalTree(intervals[axisName]);
    });

    // scaffolds and intervalNames operate in the same way - could be merged or factored.
    let domain = Array.from(intervalNames.keys());
    console.log("makeTree intervalNames.keys().length", domain.length);
    let result = 
    {
      'intervalNames' : intervalNames,
      'intervalTree' : intervalTree
    };
    return result;
  },

  /**
   * @param resized	undefined or {width, height}, which are true if the caller is a resize event.
   * @param tracks	result of tracksTree
   */
  layoutAndDrawTracks(resized, tracks)
  {
    /** this axis-tracks, used for blockIndex, which perhaps should be factored
     * out to here, if it does not change. */
    let thisAt = this;

    // seems run.throttle() .. .apply() is wrapping args with an extra [] ?
    if (resized && (resized.length == 2) && (tracks === undefined))
    {
      tracks = resized[1];
      resized = resized[0];
    }
    console.log("layoutAndDrawTracks", resized, tracks, tracks.intervalNames, tracks.intervalTree);
    /* identify axis by axisID.
     * (initial version supported only 1 split axis).  Could prefix selection with stack id.
     * <g class="axis-use">
     */
    let axisID = this.get('axisID'),
    aS = selectAxis(axisID);
    let
      oa = this.get('axis1d.drawMap.oa'),
    axis = oa.axes[axisID];
    /* if parent is un-viewed, this function may be called after axis is removed
     * from stacks. */
    if (! axis || ! axis.extended)
    {
      let gp = 
      // <g.axis-use> may already be gone.
      aS.select("g.axis-use")
        .selectAll("g.tracks");
      console.log('removing', gp.nodes(), gp.node());
      gp
        .remove();
      return;
    }
    let gAxis = aS.select("g.axis-use"),
    /** relative to the transform of parent g.axis-outer */
    bbox = gAxis.node().getBBox(),
    yrange = [bbox.y, bbox.height];
    dLog(gAxis.node());
    /** could skip the reference block blockIds[0]. */
    let blockIds = d3.keys(tracks.intervalTree);
    let
    /** For parseIntervals(), blockId is "1"; otherwise expect that blockId is a child of axisID.
    axisID = gAxis.node().parentElement.__data__, */
    y = oa.y[axisID],
    yDomain = y.domain();
    /* bbox was originally (up until 1116292) used to calculate yrange, yDomain, pxSize;
     * now use y.range(),.domain() instead because bbox.height is affected by zoom.
     * yDomain = [y.invert(yrange[0]), y.invert(yrange[1])],
     * pxSize = ... / bbox.height;
     */
    yrange = y.range();
    let
      pxSize = (yDomain[1] - yDomain[0]) / (yrange[1] - yrange[0]);
    function trackBlocksData(blockId) {
      let t = tracks.intervalTree[blockId],
      block = oa.stacks.blocks[blockId],
      axis = block.getAxis(),
      zoomed = axis && axis.axis1d && axis.axis1d.zoomed,
      /** if zoomed in, tracks are not filtered by sizeThreshold.
       * The logic is : if the user is zooming in, they are interested in
       * features regardless of size, e.g. smaller than a pixel.
       * [ sizeThreshold is disabled by setting to undefined, while we prototype how to select a sub-set of features to display ]
       */
      sizeThreshold = undefined, // zoomed ? undefined : pxSize * 1/*5*/,
      tracksLayout = regionOfTree(t, yDomain, sizeThreshold, true),
      data = tracksLayout.intervals;
      if (false)  // actually need to sum the .layoutWidth for all blockId-s, plus the block offsets which are calculated below
      setClipWidth(axisID, tracksLayout.layoutWidth);
      console.log('trackBlocksData', blockId, data.length, (data.length == 0) ? '' : y(data[0][0]));
      return data;
    };
    // a block with 1 feature will have pxSize == 0.  perhaps just skip the filter.
    if (pxSize == 0)
      console.log('pxSize is 0', yrange, yDomain);
    /** datum is interval array : [start, end];   with attribute .description. */
    function xPosn(d) { /*console.log("xPosn", d);*/ return ((d.layer || 0) + 1) *  trackWidth * 2; };
    function yPosn(d) { /*console.log("yPosn", d);*/ return y(d[0]); };
    function height(d) {
      /** if axis.zoomed then 0-height intervals are included, not filtered out.
       * In that case, need to give <rect> a height > 0.
       */
      let height = (d[1] == d[0]) ? 0.01 : y(d[1]) - y(d[0]);
      /* There was an issue causing NaN here, likely caused by 1-element array
       * .value, which is now handled.   Here that was causing d[1] undefined,
       * and hence y(d[1]) NaN.
       */
      if (Number.isNaN(height) && (trace_count_NaN-- > 0))
      {
        console.log('height NaN', d, 'y:', y.domain(), y.range());
      }
      return height;
    };
    function blockTransform(blockId, i) {
      /** -	plus tracksLayout.layoutWidth for each of the blockId-s to the left of this one. */
      let xOffset = (i+1) * 2 * trackWidth;
      return 'translate(' + xOffset + ',0)';
    }
    /** parent; contains g > rect, maybe later a text.resizer.  */
    let gpS =   gAxis
      .selectAll("g.tracks")
      .data(blockIds, I),
    gp = gpS
      .enter()
      .append("g")  // .insert(, ":last-child")
      .attr('class', 'tracks'),
    gpM = gp
      .merge(gpS)
      .attr('id', function (blockId) { console.log('', this, blockId); return trackBlockEltIdPrefix + blockId; })
      .attr('transform', blockTransform);
    gpS.exit().remove();
    /* this is for resizing the width of axis-tracks; may instead scale width of
     * rectangles to fit available width. */
    if (false) { // not completed.  Can base resizedParentElt() on axis-2d.js : resized()
    let text = gp
      .append("text")
      .attr('class', 'resizer')
      .html("⇹")
      .attr("x", bbox.width-10);
    if (gp.size() > 0)
      eltWidthResizable("g.axis-use > g.tracks > text.resizer", resizedParentElt);
  }
    /** define the clipPath.  1 clipPath per axis. */
    let clipRectS =
      gAxis.selectAll('clipPath')
      .data([axisID]),
    clipRect = clipRectS
      .enter()
      .append("clipPath")       // define a clip path
      .attr("id", axisEltIdClipPath) // give the clipPath an ID
      .append("rect")          // shape it as a rect
    ;
    clipRectS
      .exit().remove();
    /* During zoom calcs, axis-ticks positions elements before the data is
     * re-filtered, causing gAxis bbox to be large.  Don't resize to that.
     * No longer using bbox.height anyway
     * (resized && (resized.width || resized.height) && )
     */
    if (clipRect.size() == 0)
    {
      clipRect = gAxis.selectAll("clipPath > rect");
      console.log('clipRect', clipRect.size(), bbox, clipRect.node());
    }
    if (bbox.x < 0)
      bbox.x = 0;
    bbox.y = yrange[0] ;
    bbox.width = this.get('layoutWidth');
    bbox.height = yrange[1] - yrange[0];
    clipRect
      .attr("x", bbox.x)
      .attr("y", bbox.y)
      .attr("width", bbox.width)
      .attr("height", bbox.height)
    ;
    if (clipRect.size())
    {
      console.log('clipRect', bbox.width, clipRect.node());
    }
    let g = gp.append("g")
      .attr("clip-path", "url(#" + axisEltIdClipPath(axisID) + ")"); // clip the rectangle

    function trackKeyFn(featureData) { return featureData.description; }
    /** Add the <rect> within <g clip-path...>  */
    let
      /** block select - datum is blockId. */
      bs = gAxis.selectAll("g.axis-use > g.tracks > g"),
    a = bs.each(function(blockId,i,g) {
      let
        block = oa.stacks.blocks[blockId],
      tags = block.block.get('datasetId.tags'),
      subElements = tags && (tags.indexOf("geneElements") >= 0),
      eachFn = subElements ? eachGroup : eachRect;
      eachFn.apply(this, [blockId, i, g]);
        });
    function eachRect(blockId, i, g) {
      let
        rs = bs.selectAll("rect.track")
      .data(trackBlocksData, trackKeyFn),
    re =  rs.enter(), rx = rs.exit();
    dLog(rs.size(), re.size(),  'rx', rx.size());
    rx.remove();

      appendRect.apply(this, [re, rs, trackWidth, false]);
    }
    /** - rename re and rs to ge and gs
     * es could be called rs
     * @param subElements true if (gene) sub-elements (intro/exon) are displayed for this block.
     */
    function appendRect(re, rs, width, subElements) {
    let ra = re
      .append("rect");
    ra
      .attr('class', 'track')
      // .transition().duration(featureTrackTransitionTime)
      .attr('width', width)
      .each(subElements ? configureSubTrackHover : configureTrackHover);
      let blockIndex = thisAt.get('axis1d.blockIndexes'),
      /** the structure here depends on subElements:
       * true : g[clip-path] > g.track.element > rect.track
       * false : g[clip-path] > rect.track
       * appendRect() could also be used for geneElementData[], which would pass isSubelement=true.
       */
      isSubelement = false,
      gSelector = subElements ? '.track' : '[clip-path]',
      elementSelector = isSubelement ? '.element' : ':not(.element)',
      es = subElements ?
        rs.selectAll("g" + gSelector + " > rect.track" + elementSelector) : rs,
      /** ra._parents is the g[clip-path], whereas es._parents are the g.track.element
       * es.merge(ra) may work, but ra.merge(es) has just 1 elt.
       */
      rm = es
        .merge(ra);
      dLog('rm', rm.node(), 'es', es.nodes(), es.node());
      rm
      // .transition().duration(featureTrackTransitionTime)
      .attr('x', xPosn)
      .attr('y', yPosn)
      .attr('height' , height)
      .attr('stroke', blockTrackColourI)
      .attr('fill', blockTrackColourI)
      ;
      dLog('ra', ra.size(), ra.node(), 'rm', rm.size(), rm.node());
      // result is not used yet.
      return ra;
    }
    /** subElements */
    function eachGroup(blockId, i, g) {
      let
        egs = bs.selectAll("g.element")
      // probably add geneKeyFn showing sub-element details, e.g. typeName, start/end, sequence?
        .data(trackBlocksData, trackKeyFn),
      ege =  egs.enter(), egx = egs.exit();
      dLog('ege', ege.node(), 'egx', egx.nodes());
      egx.remove();
    let ega = ege
      .append("g")
      .attr('class', 'track element');
      dLog('ega', ega.node(), ega.size(), egs.size());

      let
        egm = egs.merge(ega),
        era = appendRect.apply(this, [ega, egs, trackWidth, true]);


        // re =  rs.enter(), rx = rs.exit();

      /** geneElementData will be a function of d (feature / interval).
       * [start, end, typeName] :
       * start, end are relative to the feature / interval / track / gene.
       */
      let geneElementData_dev = [
        [0.1, 0.2, 'intron'],
        [0.55,0.8, 'utr'],
        [0.45,0.35,'exon'],
      ];
      /** If true then use the development data, otherwise get the real data from the feature .value[]. */
      const useDevData = false;
      /** @return the sub-element data extract from a Feature.value.
       * @param d Feature.value
       */
      function elementDataFn (d, i, g) {
        let featureValue = d;
        featureValue = featureValue && featureValue[2];
        if (! Ember.isArray(featureValue))
          featureValue = [];
        return featureValue;
      }
      /** Map the given typeName to the characteristics of the shape which will
       * represent that type.  This is a description of the shape, not the
       * symbol it represents; i.e. the same shape could be used for 2 different
       * gene sub-element types.
       */
      class ShapeDescription {
        /** @param typeName */
        constructor(typeName) {
          /** true means show a pointed tip on the rectangle, indicating read direction.
           */
          this.showArrow = false;
          this.width = trackWidth / 2;
          switch (typeName) {
          case 'intron' :
            this.tagName = 'path';
            this.useLine = true;
            /** side-spur for intron */
            this.sideWedge = true;
            this.width = 1;
            this.fill = null;  // set in css. 'none'; // inherits black, so set none.
            break;

          case 'mRNA':
            this.tagName = 'path';
            this.useLine = true;
            this.width = 1;
            break;

          case 'exon':
          case 'CDS':
            this.tagName = this.showArrow ? 'path' : 'rect';
            this.useLine = false;
            break;

          case 'utr':
          case 'five_prime_UTR':
          case 'three_prime_UTR':
            this.useLine = true;
            /** blue fill for utr (dashed thick blue line, maybe arrow head), */
            this.tagName = 'path';
            this.width = trackWidth / 3;
            this.showArrow = true;
            break;

            default :
            this.tagName = 'path';
            dLog('ShapeDescription', typeName);
            break;
          }
          /** default stroke and fill is blockTrackColourI
           * if fill===stroke then can use path instead of rect
           */
        }
      };

      /* would use ega here, but the sub-element may be added in a separate pass after the parent g.track.element.   */
      egm.each(function (d, i, g) {
        let
          a = d3.select(this);
        let heightD = height.apply(this, [d, i, g]);
        if (heightD < subElementThresholdHeight)
        {
          let ses = a
            .selectAll('g.track.element > .track.element');
          ses.remove();
        } else {
          let geneElementData = useDevData ? geneElementData_dev : elementDataFn.apply(this, arguments);
          geneElementData.forEach(subEltDescription);
          // layer the geneElementData
          geneElementData = thisAt.layerSubElements(blockId, d.description, geneElementData);
          let ges = a.selectAll('g.track.element > ' + '.track.element')
            .data(geneElementData);
          let
            ea = ges
              .enter()
            .append((e) => {
              let typeName = e.data[2],
              shape = e.shape || (e.shape = new ShapeDescription(typeName));
              return document.createElementNS("http://www.w3.org/2000/svg", shape.tagName); });
            ges
              .exit()
              .remove();
          // ea.each(subEltDescription);
          function subEltDescription(e, j) {
            let [start, end, typeName] = e;
            let shape = e.shape;
            if (! e.description) {
              e.description = d.description + ' : ' +
                start + '-' + end + ' ' + typeName;
              dLog('e.description', e.description, d.description, d, e);
            }
          };
          ea
            .attr('class', (e) => {
              let typeName = e.data[2];
              if (typeName.endsWith('_prime_UTR')) 
                typeName += ' utr';
              return 'track element ' + typeName;
            })
          // .transition().duration(featureTrackTransitionTime)
            .each(function (e, i, g) {
              let s = d3.select(this), shape = e.shape;
              s.attr(shape.tagName === 'path' ? 'stroke-width' : 'width', shape.width); })
            .each(configureSubTrackHover);
        }
      });
      // ega.each was used for .append();  egm.each is used to update size.
      // could now factor these 2 loops together ..
      egm.each(function (d, i, g) {
        let
          a = d3.select(this),
          /** height, xPosn, yPosn don't use `this`, i or g, but they could, so
           * the standard d3 calling signature is used.
           * ((d,i,g) => height(d, i, g))(d,i,g) should also work but it compiles to a function without .apply
           */
        heightD = height.apply(this, [d, i, g]);
        if (heightD > subElementThresholdHeight) {
          let
            xPosnD = xPosn.apply(this, [d, i, g]),
          yPosnD = yPosn.apply(this, [d, i, g]);
          let geneElementData = useDevData ? geneElementData_dev : elementDataFn.apply(this, arguments);
          // layer the geneElementData
          geneElementData = thisAt.layerSubElements(blockId, d.description, geneElementData);
          let ges = a.selectAll('g.track.element > ' + '.track.element')
            .data(geneElementData);
          ges.each(function(e, j) {
            let [start, end, typeName] = e.data,
            /** signed vector from start -> end. */
            heightElt;
            if (useDevData)
              heightElt = heightD * (end - start);
            else {
              start = y(start);
              end = y(end);
              heightElt = (end - start);
            }
            let shape = e.shape || (e.shape = new ShapeDescription(typeName));
            /** x and y position of sub-element */
            let ex = xPosnD + trackWidth * 2,
            ey = useDevData ? yPosnD + heightD * start : start;
            let showDimensions = shape.useLine ? lineDimensions : shape.showArrow ? elementDimensions : rectDimensions;
            /** sub-element selection */
            let ses =
              d3.select(this)
            // .transition().duration(featureTrackTransitionTime)
              .each(showDimensions);
            if (shape.stroke !== null)
              ses.attr('stroke', shape.stroke || blockTrackColourI);
            if (shape.fill !== null)
              ses.attr('fill', shape.fill || blockTrackColourI);

            function lineDimensions(d, i, g) {
              let
                /** cut-down version of rectArrow() - the rectangle centreline
                 * could be factored out.
                 */
                tipEndsY = [0, heightElt],
              endsY = [0, heightElt],
              tipY = tipEndsY[1],
              width = trackWidth / 2,
              centreX = width/2,
              wedgeX = width/2,
              centreLine = [
                [centreX, 0],
                [centreX, tipY]
              ],
              sideWedge = [
                [centreX+wedgeX, tipY],
                [centreX+wedgeX*2, heightElt / 2],
                [centreX+wedgeX, 0]
              ],
              /** put the centreLine last, because marker-end. */
              points = shape.sideWedge ?
                sideWedge.concat(centreLine) : centreLine,
              l =
                d3.select(this)
                .attr('d', d3.line()(points))
                .attr('transform', (d) => "translate(" + (d.layer*trackWidth + ex) + ", " + ey + ")");
              dLog('lineDimensions', heightElt, width, points, sideWedge);
              if (shape.showArrow) {
                let arrow = (shape.width === 1) ? 'arrow' : 'fat_arrow';
                l.attr('marker-end', (heightElt < 20) ? "none" : 'url(#marker_' + arrow + ')');
              }
            }
            function rectDimensions(d, i, g) {
              d3.select(this)
                .attr('x', ex + d.layer*trackWidth)
                .attr('y', ey)
                .attr('height' , heightElt);
            }
            function rectArrow(d, i, g) {
              /** signed, according to direction start -> end. */
              let arrowLength = heightElt / 3, // 10,
              tipEndsY = [0, heightElt],
              endsY = [0, heightElt],
              direction = start < end,
              directionFrom = +!direction,
              directionTo = +direction;
              endsY[1] -= arrowLength;
              let
                tipY = tipEndsY[1],
              width = shape.width,
              tip = [[width/2, tipY]],
              append  = direction ? 'push' : 'unshift',
              /** the arrow tip is added between 2 points with the same y. */
              pointsLeft = [
                [0, endsY[directionFrom]],
                [0, endsY[directionTo]]
              ],
              pointsRight = [
                [width, endsY[directionTo]],
                [width, endsY[directionFrom]]
              ],
              points = direction ?
                pointsLeft.concat(tip, pointsRight) :
                pointsLeft.concat(pointsRight, tip);
              let
                l =  d3.line()(points) + 'Z';
              dLog('rectarrow', arrowLength, tipEndsY, endsY, direction, tip, append, points, l);
              return [l];
            }

            function elementDimensions(d, i, g) {
              d3.select(this)
                .attr('transform', "translate(" + (d.layer*trackWidth + ex) + ", " + ey + ")")
                .attr('d', rectArrow);
            }
          });
        }
      });
    }

    function blockTrackColourI (b) {
      let parent = this.parentElement;
      if (! parent.getAttribute('clip-path')) {
        parent = parent.parentElement;
        // can check that parent has clip-path, and data is string
      }
        let blockId = parent.__data__,
      blockIndex = thisAt.get('axis1d.blockIndexes'),
        /** If blockIndex{} is not collated yet, can scan through blockIds[] to get index.
         * Actually, the number of blocks will be 1-10, so collating a hash is
         * probably not time-effective.
         */
        i = blockIndex && blockIndex[blockId];
        if (i === undefined)
          i = blockIds.indexOf(blockId);
        // console.log(d,i,b);
        // colour is calculated from i, not blockId.
        // index into axis.blocks[] = <g.tracks> index + 1
        return axisTitleColour(blockId, i+1) || 'black';
      }

    /** not yet used, see also above blockTrackColourI() */
    function blockColour(selector) {
    function blockTrackColour(d,i,g) {
      d3.select(this).selectAll(selector)
        // .transition().duration(featureTrackTransitionTime)
        .attr('stroke', axisTitleColourI)
        .attr('fill', axisTitleColourI);
      function axisTitleColourI (b) {
          // console.log(d,i,b);
          // index into axis.blocks[] = <g.tracks> index + 1
          return axisTitleColour(d, i+1) || 'black';
        }
    }
      return blockTrackColour;
    }
    let blockTrackColour = blockColour('rect.track');
    if (false)
    // gp
     d3.selectAll('g.tracks')
      .each(blockTrackColour);

  },

  /*--------------------------------------------------------------------------*/

  pasteProcess: function(textPlain) {
    console.log("components/axis-tracks pasteProcess", textPlain.length);

    let
    parseIntervals = this.get('parseIntervals'),
    layoutAndDrawTracks = this.get('layoutAndDrawTracks');

    let tracks = parseIntervals(textPlain);
    this.set('tracks', tracks); // used by axisStackChanged() : layoutAndDrawTracks()
    /** parseIntervals() puts the data into a blockId (refered to as axisName) "1".
     * This was refactored to incorporate the addition of trackBlocks(), showTrackBlocks();
     * if required these changes can be tested / debugged.
     */
    let blockId = "1";
    /** Parsed data is echoed in the table. */
    let forTable = tracks.intervalTree[/*blockId*/1].intervals.map(this.intervalToStartEnd);
    // intersect with axis zoom region;  layer the overlapping tracks; draw tracks.
    layoutAndDrawTracks.apply(this, [undefined, tracks]);

    this.set('data.tracks', forTable);
  },
  intervalToStartEnd : function(interval) {
      interval.start = interval[0];
      interval.end = interval[0];
      return interval;
    },

  /*--------------------------------------------------------------------------*/

  featuresForTrackBlocksRequestEffect : Ember.computed(
    'trackBlocksR.[]',
    // either axis1d.domain or yDomain is probably sufficient dependency.
    'axis1d.domain', 'yDomain',
    function () {
      dLog('featuresForTrackBlocksRequestEffect');
      let trackBlocks = this.get('trackBlocksR'),
      /** featuresForAxis() uses getBlockFeaturesInterval(), which is also used by 
       * models/axis-brush.js */
      blockFeatures = trackBlocks.map(function (b) { return b.get('featuresForAxis'); } );
      /* no return value - result is displayed by showTrackBlocks() with data
       * collated by tracksTree(). */
    }),

  /*--------------------------------------------------------------------------*/


  /** Not used; can be used in .hbs for trace, for comparison against the result
   * of showTrackBlocks(). */
  blocksFeaturesLengths : Ember.computed(
    'trackBlocksR.@each.featuresLength',
    'trackBlocks.[]', 'trackBlocksR.0.featuresLength', 'trackBlocksR.0.features.[]',
    function () {
    let lengths = this.get('trackBlocks').map((block) => [block.axisName, block.block.get('featuresLength')]);
    // similar : d3.keys(block.features())
    console.log('blocksFeaturesLengths', lengths);
    return lengths;
  }),
  tracksTree : Ember.computed('trackBlocksR.@each.featuresLength', function () {
    let axisID = this.get('axisID'),
    trackBlocksR = this.get('trackBlocksR'),
    featuresLengths = this.get('trackBlocksR').mapBy('featuresLength');
    console.log('tracksTree', axisID, this, trackBlocksR, featuresLengths);
    let
    /** similar to : axis-1d.js : showTickLocations(), which also does .filter(inRange)
     */
    intervals = trackBlocksR.reduce(
      function (blockFeatures, blockR) {
        let
        blockId = blockR.get('id'),
        features = blockR.get('features')
         .toArray()  //  or ...
          .map(function (feature) {
            let interval = feature.get('range') || feature.get('value');
            /* copy/paste into CSV in upload panel causes feature.value to be a
             * single-element array, e.g. {name : "my1AGene1", value : [5200] } */
            if (! interval.length || (interval.length == 1))
              interval = [interval, interval];
            /* interval-tree:createIntervalTree() assumes the intervals are positive, and gets stack overflow if not. */
            else if (interval[1] === null) {
              /* undefined / null value[1] indicates 0-length interval.  */
              interval[1] = interval[0];
            }
            else if (interval[0] > interval[1]) {
              let swap = interval[0];
              interval[0] = interval[1];
              interval[1] = swap;
            }
            interval.description = feature.get('name');
            return interval;
          });
        blockFeatures[blockId] = features;
        return blockFeatures;
      }, {}),
    intervalNames = d3.keys(intervals),
    tracks = this.makeTree(intervals, intervalNames);
    // now that this is a computed function, don't need to store the result.
    this.set('tracks', tracks); // used by axisStackChanged() : passed to layoutAndDrawTracks()
    return tracks;
  }),

  layerSubElements(blockId, featureId, geneElementData) {
    let blocks = this.get('blocks'),
    blockState = blocks[blockId] || (blocks[blockId] = {});
    if (! blockState.subEltTree)
      blockState.subEltTree = {};
    if (! blockState.subEltTree[featureId]) {
      let
        intervalNames = geneElementData.mapBy('description'),
      intervals = geneElementData.map(SubElement.getInterval),
      /** just conforming to the signature of makeTree() - probably no need to index by blockId here. */
      intervalsByBlockId = {};
      intervalsByBlockId[blockId] = intervals;
      blockState.subEltTree[featureId] = this.makeTree(intervalsByBlockId, intervalNames);
    }
    let
    subEltTree = blockState.subEltTree[featureId],
      /** sizeThreshold would be used if the sub-elements were only displayed when
       * zoomed so that their pixel represention was large enough to be
       * useful.
       */
      sizeThreshold = undefined,
    /** passing yDomain to regionOfTree() will hide sub-elements as they move
     * out of scope during zoom/pan; when they re-enter scope they may be
     * layered differently than when all sub-elements are added at the same
     * time, so this is not done (and there is an update issue with rerending in
     * this case).  */
    // yDomain = this.get('yDomain'),
    tracksLayout = regionOfTree(subEltTree.intervalTree[blockId], undefined, sizeThreshold, false),
    data = tracksLayout.intervals;
    return data;
  },


  layoutWidth : Ember.computed('trackBlocksR.[]', function () {
    let
    trackBlocksR = this.get('trackBlocksR'),
    blockIds = trackBlocksR.mapBy('id'),
    /** Add 50 on the right to avoid clashing with the right axis ticks text,
     * which may later be switched off with CSS.
     * this includes xOffset from blockTransform(blockIds.length-1) 
     * @see blockTransform()
     */
    width =
      40 + blockIds.length * 2 * trackWidth + 20 + 50;
    console.log('layoutWidth', blockIds, width);
    this.get('childWidths').set(this.get('className'), [width, width]);
    return width;
  }),
  showTrackBlocks: Ember.computed(
    'tracksTree', 'yDomain.0', 'yDomain.1', 'axis1d.zoomed', 'axis1d.extended', 'axis1d.featureLength',
    'featuresForTrackBlocksRequestEffect',
    function() {
      this.get('featuresForTrackBlocksRequestEffect');
      let tracks = this.get('tracksTree');
      let axis1d = this.get('axis1d'),
      zoomed = this.get('axis1d.zoomed'),
      isViewed = axis1d.axis.get('isViewed'),
      extended = this.get('axis1d.extended'),
      featureLength = this.get('axis1d.featureLength'),
      yDomain = this.get('yDomain');
      console.log('showTrackBlocks', this, tracks, axis1d, isViewed, yDomain, 'axis1d.zoomed', zoomed, extended, featureLength);
      let featuresLength;
      if (isViewed) {
    let blockIds = d3.keys(tracks.intervalTree);
    if (false) {
      let blockId = blockIds[0];
      /** would use this to display the details of the features in the interval, in the data-table within the split axis. */
      let forTable = tracks.intervalTree[blockId].intervals.map(this.intervalToStartEnd);
    }
    // intersect with axis zoom region;  layer the overlapping tracks; draw tracks.
    this.layoutAndDrawTracks.apply(this, [undefined, tracks]);
    featuresLength = blockIds.map((blockId) => [blockId, tracks.intervalTree[blockId].intervals.length]);
    console.log('showTrackBlocks() featuresLength', featuresLength);
      }
    return featuresLength;
  }),
  resizeEffectHere : Ember.computed('resizeEffect', function () {
    let result = this.get('resizeEffect');
    dLog('resizeEffectHere in axis-tracks', this.get('axisID'), result);
    /** @return true if rc[f] indicates a change of field f.
     * if the previous size is not recorded, then treat it as a change.
     */
    function isChanged(rc, f) { return rc ? rc[f] : true; }
    this.showResize(isChanged(result.changed, 'viewportWidth'), isChanged(result.changed, 'viewportHeight') /* , yScaleChanged ? */);
  }),


  keypress: function(event) {
    console.log("components/axis-tracks keypress", event);
  }


});

