import { debounce, throttle } from '@ember/runloop';
import { computed } from '@ember/object';
import Component from '@ember/component';
import { inject as service } from '@ember/service';

import AxisEvents from '../../utils/draw/axis-events';

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
    if (trace)
      dLog("axisStackChanged in ", CompName);
    /* draw-map : axisStackChanged() / axisStackChanged_() already does throttle. */
    this.renderTicks();
  },

  /** @param [axisID, t] */
  zoomedAxis : function(axisID_t) {
  },

  /** Render elements which are dependent on axis scale - i.e. the axis ticks.
   */
  axisScaleEffect : computed('axis1d.domainChanged', function () {
    let axisScaleChanged = this.get('axis1d.domainChanged');
    let axisID = this.get('axisID');
    if (trace)
      dLog('axisScaleChanged', axisID, this.get('axis.id'));
    this.renderTicksThrottle(axisID);
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
    // currently called via didRender(), so ticks and labels are both updated.
    this.renderLabels(axisID);
  },
  renderLabels(axisID) {
    let featureTicks = this.get('axis1d.featureTicks');
    let
    block = this.axis1d.axis,
    labelledFeatures = this.get('selected.labelledFeaturesByAxis').get(block);
    if (labelledFeatures) {
      featureTicks.showLabels(
        this.labelledFeaturesOfBlockLookup.bind(this),
        true,
        'labelledFeatures', false
      );
    }
  },
  /** call renderTicks().
   * filter / throttle the calls to handle multiple events at the same time.
   * @param axisID  undefined, or this.get('axisID') (not required or used);
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
    /** features found by goto-feature-list, indexed by block id. */
    let featuresInBlocks = this.get('featuresInBlocks');
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
   * @param block Ember object
   */
  labelledFeaturesOfBlockLookup(block) {
    let labelledFeatures = this.get('selected.labelledFeaturesByBlock').get(block);
    if (trace)
      dLog('labelledFeaturesOfBlockLookup', featuresInBlocks, block, block.id, labelledFeatures);
    return labelledFeatures;
  },

  clickTriangle(feature, i, g) {
    dLog('clickTriangle', feature, i, g.length, g[i], this);
    this.selected.clickLabel(feature);
    let labelledFeatures = this.selected.labelledFeatures;
    dLog(labelledFeatures.mapBy('blockId.mapName'), labelledFeatures.map((f) => [f.name, f.value]));
  }

});

