import { on } from '@ember/object/evented';
import Mixin from '@ember/object/mixin';

const dLog = console.debug;

/** Listen for axisStackChanged and zoomedAxis on drawMap and call the
 * corresponding functions.
 * Used by axes-1d.js and axis-2d.js
 */
export default Mixin.create({


  listen: on('init', function() {

    /** handle of the draw-map */
    let drawMap = this.get('drawMap'); 
    dLog("listen", drawMap);
    if (drawMap === undefined)
      dLog('parent component drawMap not passed');
    else {
      drawMap.on('axisStackChanged', this, 'axisStackChanged');
      drawMap.on('resized', this, 'resized');
      drawMap.on('zoomedAxis', this, 'zoomedAxis');
    }
  }),

    // remove the binding created in listen() above, upon component destruction
  cleanup: on('willDestroyElement', function() {

    let drawMap = this.get('drawMap');
    if (drawMap)
    drawMap.off('axisStackChanged', this, 'axisStackChanged');
    drawMap.off('resized', this, 'resized');
    drawMap.off('zoomedAxis', this, 'zoomedAxis');
      })

});
