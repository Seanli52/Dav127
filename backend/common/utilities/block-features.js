var ObjectID = require('mongodb').ObjectID;

/*----------------------------------------------------------------------------*/

/* global exports */

const trace_block = 1;

/** ObjectId is used in mongo shell; the equivalent defined by the node js client library is ObjectID; */
const ObjectId = ObjectID;

/*----------------------------------------------------------------------------*/


/** Count features of the given blocks.
 *
 * @param blockCollection dataSource collection
 * @param blockIds  ids of data blocks
 *
 * @return cursor	: features
 */
exports.blockFeaturesCount = function(db, blockIds) {
  // initial draft based on blockFeaturesInterval()
  let featureCollection = db.collection("Feature");
  if (trace_block)
    console.log('blockFeaturesCount', blockIds);
  let ObjectId = ObjectID;

  let
    matchBlock =
    [
	    { $match :  { "blockId" : {$in : blockIds.map(function (blockId) { return ObjectId(blockId); }) }}},
      { $group: { _id: '$blockId', featureCount: { $sum: 1 } } }
    ],

    pipeline = matchBlock;

  if (trace_block)
    console.log('blockFeaturesCount', pipeline);
  if (trace_block > 1)
    console.dir(pipeline, { depth: null });

  let result =
    featureCollection.aggregate ( pipeline, {allowDiskUse: true} );

  return result;

};

/*----------------------------------------------------------------------------*/

/** Calculate the bin size for even-sized bins to span the given interval.
 * The bin size is rounded to be a multiple of a power of 10, only the first 1-2
 * digits are non-zero.
 * Used in @see binBoundaries().
 * @return lengthRounded
 */
function binEvenLengthRound(interval, nBins) {
  let lengthRounded;
  if (interval && (interval.length === 2) && (nBins > 0)) {
    /* if (interval[1] < interval[0])
     interval = interval.sort(); */
    let intervalLength = interval[1] - interval[0],
    binLength = intervalLength / nBins,
    digits = Math.floor(Math.log10(binLength)),
    eN1 = Math.exp(digits * Math.log(10)),
    mantissa = binLength / eN1,
    /** choose 1 2 or 5 as the first digit of the bin size. */
    m1 = mantissa > 5 ? 5 : (mantissa > 2 ? 2 : 1);
    if (digits >= 0) {
      lengthRounded = Math.round(m1 * eN1);
    } else {
      /** for e.g. digits===-1, eN1 is 0.09999999999999998,
       * and (m1 * eN1) is 0.4999999999999999 which will round down to 0.
       * So instead, use string operation to construct eN1, so .round() is not required.
       * This could probably be used for digits >= 0 also.
       *
       * A simpler form would be Math.round(m1 * eN1 * 100000) / 100000, but
       * that is limited to digits > -5, which would be sufficient for the
       * datasets used so far, e.g. a genetic map is ~200cM, so digits===-1, and
       * for a physical map digits==-6.
       */
      eN1 = '0.' + ('000000000000000'.substr(0, 1+digits)) + '1';
      lengthRounded = (m1 * eN1);
    }

    console.log('binEvenLengthRound', interval, nBins, intervalLength, binLength, digits, eN1, mantissa, m1, lengthRounded);
  }
  return lengthRounded;
};
/** Generate an array of even-sized bins to span the given interval.
 * Used for mongo aggregation pipeline : $bucket : boundaries.
 */
function binBoundaries(interval, lengthRounded) {
  let b;
  if (lengthRounded) {
    let
      start = interval[0],
    intervalLength = interval[1] - interval[0],
    direction = Math.sign(intervalLength),
    forward = (direction > 0) ?
      function (a,b)  {return a < b; }
    : function (a,b)  {return a > b; };

    let location = Math.floor(start / lengthRounded) * lengthRounded;
	  b = [location];
    do {
      location += lengthRounded;
      b.push(location);
    }
    while (forward(location, interval[1]));
    console.log('binBoundaries', direction, b.length, location, b[0], b[b.length-1]);
  }
  return b;
};




/** Count features of the given block in bins.
 *
 * @param blockCollection dataSource collection
 * @param blockId  id of data block
 * @param interval  if given then use $bucket with boundaries in this range,
 * otherwise use $bucketAuto.
 * @param nBins number of bins to group block's features into
 *
 * @return cursor	: binned feature counts
 * { "_id" : { "min" : 4000000, "max" : 160000000 }, "count" : 22 }
 * { "_id" : { "min" : 160000000, "max" : 400000000 }, "count" : 21 }
 */
exports.blockFeaturesCounts = function(db, blockId, interval, nBins = 10) {
  // initial draft based on blockFeaturesCount()
  let featureCollection = db.collection("Feature");
  /** The requirement (so far) is for even-size boundaries on even numbers,
   * e.g. 1Mb bins, with each bin boundary a multiple of 1e6.
   *
   * $bucketAuto doesn't require the boundaries to be defined, but there may not
   * be a way to get it to use even-sized boundaries which are multiples of 1eN.
   * By default it defines bins which have even numbers of features, i.e. the
   * bin length will vary.  If the parameter 'granularity' is given, the bin
   * boundaries are multiples of 1e4 at the start and 1e7 near the end (in a
   * dataset [0, 800M]; the bin length increases in an exponential progression.
   *
   * So $bucket is used instead, and the boundaries are given explicitly.
   * This requires interval; if it is not passed, $bucketAuto is used, without granularity.
   */
  const useBucketAuto = ! (interval && interval.length === 2);
  if (trace_block)
    console.log('blockFeaturesCounts', blockId, interval, nBins);
  let ObjectId = ObjectID;
  let lengthRounded, boundaries;
  if (! useBucketAuto) {
    lengthRounded = binEvenLengthRound(interval, nBins),
    boundaries = binBoundaries(interval, lengthRounded);
  }
    
  let
    matchBlock =
    [
      {$match : {blockId :  ObjectId(blockId)}},
      useBucketAuto ? 
        { $bucketAuto : { groupBy: {$arrayElemAt : ['$value', 0]}, buckets: Number(nBins)}  } // , granularity : 'R5'
      : { $bucket     :
          {
            groupBy: {$arrayElemAt : ['$value', 0]}, boundaries,
	    'default' : 'outsideBoundaries',
            output: {
              count: { $sum: 1 },
              idWidth : {$addToSet : lengthRounded }
            }
          }
        }
    ],

    pipeline = matchBlock;

  if (trace_block)
    console.log('blockFeaturesCounts', pipeline);
  if (trace_block > 1)
    console.dir(pipeline, { depth: null });

  let result =
    featureCollection.aggregate ( pipeline, {allowDiskUse: true} );

  return result;

};

/*----------------------------------------------------------------------------*/


/** Collate max & min feature values of the given block.
 *
 * Also includes the count of Features in each block, which is also returned by
 * blockFeaturesCount(); if this function has similar performance then it could
 * be used in place of blockFeaturesCount().
 *
 * @param db connected dataSource
 * @param blockId  id of data block.  optional - if undefined then all blocks are scanned.
 * The existing backend URL-level cache can effectively cache requests for a single blockId or for
 * all (blockId===undefined), whereas another caching facility would be required
 * for requests with an array of blockIds.
 *
 * @return cursor	: max and min feature values
 * e.g.
 * { "_id" : ObjectId("5cc69ed7de8ab9393f45052d"), "max" : 494550358, "min" : 447129 }
 */
exports.blockFeatureLimits = function(db, blockId) {
  // initial draft based on blockFeaturesCounts()
  let featureCollection = db.collection("Feature");
  if (trace_block)
    console.log('blockFeatureLimits', blockId);
  let ObjectId = ObjectID;

  /** unwind the values array of Features, and group by blockId, with the min &
   * max values within the Block.
   * value may be [from, to, anyValue], so use slice to extract just [from, to],
   * and $match $ne null to ignore to === undefined.
   * The version prior to adding this comment assumed value was just [from, to] (optional to);
   * so we can revert to that code if we separate additional values from the [from,to] location range.
   *
   * We currently have data which has just a number or string for value instead of an array;
   * handle this by checking for $type and applying $slice to the array type only.
   */
  let
    group = [
      {$project : {_id : 1, name: 1, blockId : 1, value : 
      {$cond: { if: { $isArray: "$value" }, then: {$slice : ['$value', 2]}, else: "$value" } }  }},
      {$unwind : '$value'}, 
      {$match: { $or: [ { value: { $ne: null } } ] } },
      {$group : {
        _id : '$blockId' ,
        featureCount : { $sum: 1 },
        max : { "$max": "$value" }, 
        min : { "$min": "$value" }
      }}
    ],
  pipeline = blockId ?
    [
      {$match : {blockId :  ObjectId(blockId)}}
    ]
    .concat(group)
  : group;

  if (trace_block)
    console.log('blockFeatureLimits', pipeline);
  if (trace_block > 1)
    console.dir(pipeline, { depth: null });

  let result =
    featureCollection.aggregate ( pipeline, {allowDiskUse: true} );

  return result;

};


/*----------------------------------------------------------------------------*/
