import { debounce, throttle, bind as run_bind } from '@ember/runloop';
import { computed } from '@ember/object';
import Component from '@ember/component';
import { inject as service } from '@ember/service';
import { on } from '@ember/object/evented';

import { task, timeout, didCancel } from 'ember-concurrency';

import AxisEvents from '../../utils/draw/axis-events';
import { transitionEndPromise } from '../../utils/draw/d3-svg';

const trace = 0;
const dLog = console.debug;

const CompName = 'components/axis-ticks-selected';

/** Display horizontal ticks on the axis to highlight the position of features
 * found using Feature Search.
 *
 * @param featuresInBlocks results of Feature Search; a lookup function for these
 * is passed to showTickLocations()
 */
export default Component.extend(AxisEvents, {
  selected : service('data/selected'),

  
  resized : function(widthChanged, heightChanged, useTransition) {
    /* useTransition could be passed down to showTickLocations()
     * (also could pass in duration or t from showResize()).
     */
    if (trace)
      dLog("resized in ", CompName);
    if (heightChanged)
      this.renderTicksThrottle();
  },

  /** axis-ticks-selected receives axisStackChanged and zoomedAxis from axis-1d,
   * which filters zoomedAxis events for by axisID.  axisStackChanged events are
   * not specific to an axisID.
   */

  /** draw-map:axisStackChanged_(t) sends transition t. */
  axisStackChanged : function() {
    /** when zoom & reset button, axisStackChanged arrives after other
     * dependency changes (zoomedDomain), and interrupts the transition they
     * started.
     * The role of axisStackChanged is probably supplanted by other, more
     * direct, dependencies added since.  Testing hasn't yet shown missing updates.
     */
    if (false) {
    if (trace)
      dLog("axisStackChanged in ", CompName);
    /* draw-map : axisStackChanged() / axisStackChanged_() already does throttle. */
    this.renderTicks();
    }
  },

  /** @param [axisID, t] */
  zoomedAxis : function(axisID_t) {
  },

  /** Render elements which are dependent on axis scale - i.e. the axis ticks.
   */
  axisScaleEffect : computed('axis1d.domainChanged', function () {
    let axisScaleChanged = this.get('axis1d.domainChanged');
    let axisID = this.get('axisId');
    // if (trace)
    dLog('axisScaleChanged', axisID, this.get('axis.id'), axisScaleChanged, this.axis1d.scaleChanged && this.axis1d.scaleChanged.domain());
    this.renderTicks/*Throttle*/(axisID);
    /** somehow renderTicks() is missing the latest scale.  redrawing after a
     * delay gets the correct scale, so the next step would be to trace the axis
     * scale in render to confirm that.
     */
    const reRenderLater = () => { this.renderTicksThrottle(axisID); };
    debounce(reRenderLater, 750);

    return true;
  }),

  didRender() {
    let featuresInBlocks = this.get('featuresInBlocks');
    if (trace)
      dLog('didRender', featuresInBlocks, this.get('axisId'),
           'axis1d ', this.get('axis1d'));
    this.renderTicksThrottle();
  },

  renderTicks(axisID) {
    if (trace)
      dLog("renderTicks in ", CompName, axisID);
    let featureTicks = this.get('axis1d.featureTicks');
    let block = this.axis1d.axis,
    /** clickedFeatures will be undefined or an array with .length > 1 */
    clickedFeatures = this.get('selected.clickedFeaturesByAxis').get(block);
    if (featureTicks || clickedFeatures) {
      featureTicks.showTickLocations(
      this.featuresOfBlockLookup.bind(this),
      false,  /* hover text not required on axis feature triangles. */
      'foundFeatures', false,
      this.clickTriangle.bind(this)        
      );
    }
    featureTicks.showSpanningLine(this.selectedFeaturesOfBlockLookup.bind(this, 'shiftClickedFeatures'));
    // currently called via didRender(), so ticks and labels are both updated.
    this.renderLabels(axisID);
  },
  renderLabels(axisID) {
    let featureTicks = this.get('axis1d.featureTicks');
    let
    block = this.axis1d.axis;
    /** if this block had labelledFeatures, and in this update they (1) are
     * toggled off, then labelledFeatures is undefined, but we still want to
     * call showLabels() to .remove() the existing <text>-s.
     */
    // labelledFeatures = this.get('selected.labelledFeaturesByAxis').get(block);
    /* if (labelledFeatures) */ {
      featureTicks.showLabels(
        this.selectedFeaturesOfBlockLookup.bind(this, 'labelledFeatures'),
        true,
        'labelledFeatures', false,
        run_bind(this, this.labelsTransitionPerform),
      );
    }
  },
  labelsTransitionPerform(transition, callFn) {
    if (true) {
      transition.call(callFn);
    } else {
    this.labelsTransitionTask.perform(transition, callFn)
      .catch(run_bind(this, this.ignoreCancellation))
      .finally(() => dLog('labelsTransitionTask', 'finally'));
    }
  },
  labelsTransitionTask : task(function * (transition, callFn) {
    let promise;
    if (! transition.size()) {
      promise = Promise.resolve();
    } else {
      transition.call(callFn);
      promise = transitionEndPromise(transition);
    }
    return promise;
  }).drop(),
  /** Recognise if the given task error is a TaskCancelation.
   */
  ignoreCancellation(error) {
    // based on similar in drawCurrentTask() (draw/block-adj.js) etc
    if (! didCancel(error)) {
      dLog('axis-ticks-selected', 'taskInstance.catch', this.axisId, error);
      throw error;
    }
  },
  /** call renderTicks().
   * filter / throttle the calls to handle multiple events at the same time.
   * @param axisID  undefined, or this.get('axisId') (not required or used);
   * undefined when called from axisStackChanged().
   *
   * (earlier versions called this from zoomedAxis(), which passed [axisID,
   * transition], so that transition length could be consistent for an event
   * across multiple components; axisStackChanged() can pass the transition,
   * although showTickLocations() does not (yet) use it.)
   */
  renderTicksThrottle(axisID) {
    if (trace)
      dLog('renderTicksThrottle', axisID);

    /* see comments in axis-1d.js : renderTicksThrottle() re. throttle versus debounce */    
    throttle(this, this.renderTicks, axisID, 500);
  },

  /** Lookup the given block in featuresInBlocks, and return its features which
   * were in the featureSearch result.
   * @param block Ember object
   */
  featuresOfBlockLookup(block) {
    /** now that feature search result is copied to selected.features, it is not
     * required to display ticks (triangles) for the feature search result
     * (featuresInBlocks).
     */
    const showSearchResult = false;
    /** features found by goto-feature-list, indexed by block id. */
    let featuresInBlocks = showSearchResult && this.get('featuresInBlocks');
    let blockId = block.get('id');
    /** return [] for blocks which don't have features in the search result. */
    let features = featuresInBlocks ? (featuresInBlocks[blockId] || []) : [];
    let clickedFeatures = this.get('selected.clickedFeaturesByBlock').get(block);
    if (clickedFeatures && clickedFeatures.length) {
      features = features.concat(clickedFeatures);
    }
    if (trace)
      dLog('featuresOfBlockLookup', featuresInBlocks, block, blockId, features);
    return features;
  },
  
  /** Lookup selected.labelledFeatures for the given block.
   * @param listName name of set / selection / group of features :
   *   'clickedFeatures', 'labelledFeatures', or 'shiftClickedFeatures'
   * @param block Ember object
   */
  selectedFeaturesOfBlockLookup(listName, block) {
    let features = this.get('selected.' + listName + 'ByBlock').get(block);
    if (trace)
      dLog('selectedFeaturesOfBlockLookup', listName, featuresInBlocks, block, block.id, features);
    return features;
  },

  clickTriangle(feature, i, g) {
    dLog('clickTriangle', feature, i, g.length, g[i], this);
    let features, listName;
    if (! d3.event.shiftKey) {
      this.selected.clickLabel(feature);
      features = this.selected.labelledFeatures;
      listName = 'labelled';
    } else {
      this.selected.shiftClickFeature(feature);
      features = this.selected.shiftClickedFeatures;
      listName = 'shiftClicked';
      document.getSelection().removeAllRanges();
    }
    dLog(listName, features.mapBy('blockId.mapName'), features && features.map((f) => [f.name, f.value]));
  },

  addRemoveKeyEventListener(listen) {
    const register = listen ? window.addEventListener : window.removeEventListener;
    ["keydown", "keypress", "keyup"].forEach(
      (eventName) => register(eventName, this.ctrlHandler, false));
  },
  listenCtrl : on('init', function () {
    this.addRemoveKeyEventListener(true);
  }),
  unListenCtrl: on('willDestroyElement', function() {
    this.addRemoveKeyEventListener(false);
  }),
  /** listener function registered by listenCtrl() */
  ctrlHandler(event) {
    // as in : query-params.js : optionsToDom()
    d3.select('body')
      .classed("ctrl-modifier", event.ctrlKey)
  }


});

