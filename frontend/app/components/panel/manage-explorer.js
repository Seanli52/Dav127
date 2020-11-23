import $ from 'jquery';
import { later, next } from '@ember/runloop';
import { resolve, all } from 'rsvp';
import { A } from '@ember/array';
import { inject as service } from '@ember/service';

import DS from 'ember-data';

import { computed } from '@ember/object';
import {
  filter,
  filterBy,
  mapBy,
  setDiff,
  uniqBy,
  uniq,
  union,
  alias,
  readOnly
} from '@ember/object/computed';

import { tab_explorer_prefix, text2EltId, datasetTypeTabId } from '../../utils/explorer-tabId';
import { parseOptions } from '../../utils/common/strings';

import { mapHash, justUnmatched, logV } from '../../utils/value-tree';


import ManageBase from './manage-base'

/* global d3 */

let initRecursionCount = 0;

/** true means show entries which don't match a FG as 'unmatched'.
 * This could be used to enable the user to segrate datasets into matching and non-matching;
 * so far it is has been used for checking results, in development.
 */
const showUnmatched = false;

let trace_dataTree = 0;
const dLog = console.debug;

/** If true, use datatypeFromFamily() to intuit a dataset type for datasets
 * which do not define _meta.type.
 * datatypeFromFamily() uses the dataset parent and children : datasets with
 * neither are considered 'unrelated', datasets with parents are 'children',
 * and datasets with children are 'references'.
 *  enable_datatypeFromFamily 
 */

const selectorExplorer = 'div#left-panel-explorer';


/*----------------------------------------------------------------------------*/


export default ManageBase.extend({
  apiServers: service(),
  controls : service(),

  init() {
    this._super();
    if (initRecursionCount++ > 5) {
      debugger;
      window.alert('initRecursionCount : ' + initRecursionCount);
    }

    let me = this;
    this.get('apiServers').on('receivedDatasets', function (datasets) { console.log('receivedDatasets', datasets); me.send('receivedDatasets', datasets); });
  },

  urlOptions : computed('model.params.options', function () {
    let options_param = this.get('model.params.options'),
    options = options_param && parseOptions(options_param);
    return options;
  }),
  enable_datatypeFromFamily : alias('urlOptions.dataTabsFromFamily'),
  /** If true then use dataParentTypedFGTree in place of dataTypedTreeFG.
   * The former groups the data by parent before filtering; the latter
   * applies FG before grouping into parents.
   * The results are the same in simple cases; still trialling to see
   * which should be default;  each approach probably handles some
   * search cases better than the other.
   */
  enable_parentBeforeFilter : alias('urlOptions.parentBeforeFilter'),

  /** Triggers a rerun of the availableMaps fetching task */
  refreshAvailable: function(){
    this.get('refreshDatasets')();
  },

  /** used by dataEmpty. */
  datasets : readOnly('datasetsBlocks'),
  /** Datasets passed in from MapView, but still need fetching on MatrixView
   * MatrixView dataset retrieval should be raised to route model / controller in future
   * At that time, 'mapviewDatasets' can be renamed to 'datasets'
   * and this whole computed element may be removed */
  x_datasets : computed('mapviewDatasets', 'view', function () {
    let view = this.get('view');
    if (view === 'mapview') {
      return this.get('mapviewDatasets');
    }
    // Else, view === matrixview
    let store = this.get('store');
    /** This filter is common to all views.
     * For matrixview, select observational. */
    let filter = {'include': 'blocks'};
    filter['where'] = {'type': 'observational'};
    let promise = store.query('dataset', {filter: filter});
    promise.then(function(datasets) {
      console.log('datasets', datasets.toArray());
    });
    let resultP = DS.PromiseArray.create({ promise: promise });
    dLog('manage-explorer matrixview datasets', promise, 'resultP', resultP);
    return resultP;
  }),
  datasetType: null,

  /** keys are 'all', and the found values of dataset._meta.type;
   * value is true if filterGroup is a filter, and datasetFilter matched at the datasets level.
   *
   * filterGroup may apply at both the dataset level and the blocks level, but
   * it makes sense to apply it at only 1 level : if there are matches at the
   * higher level (dataset) then don't apply it at a lower level (block).
   * If there are no matches at the higher level then treat the filter as not
   * having applied, and apply it instead at the lower level.
   *  i.e.
   * . if grouping, then it applies to dataset level only
   * . if filter, if any matches in a tab at dataset level, then don't apply filter at blocks level for that tab.
   *   if no matches at the dataset level then treat all values as having matched.
   *
   * filterMatched is used to implement this logic.
   */
  filterMatched : {},

  filterOptions: {
    'all': {'formal': 'All', 'icon': 'plus'},
    'private': {'formal': 'Private', 'icon': 'lock'},
    'owner': {'formal': 'Mine', 'icon': 'user'}
  },
  filter: 'all',

  /** Filter / Group patterns.  initially 0 elements. */
  filterGroups : A(), // [{}]
  filterGroupsChangeCounter : 0,
  //----------------------------------------------------------------------------

  /** Return a list of datasets, with their included blocks, for the currently-selected
   * API server tab
   */
  datasetsBlocks : computed('datasetsBlocksRefresh', 'serverTabSelected', 'primaryDatasets', function() {
    /** e.g. "http___localhost_5000"  */
    let
      name = this.get('serverTabSelected'),
    /** server of the selected tab. */
    serverSo = name &&
      this.get('apiServers').lookupServer(name),
    datasetsBlocks = serverSo && serverSo.get("datasetsBlocks");
    if (datasetsBlocks && trace_dataTree > 1)
    {
      dLog('datasetsBlocks', serverSo, datasetsBlocks);
    }
    let isPrimary = serverSo && (this.get('apiServers').get('primaryServer') === serverSo);
    if (! name || (! datasetsBlocks && isPrimary))
    {
      /* this is using the model datasets list for the primary API.
       * Perhaps instead will change mapview to use apiServers service.
       */
      datasetsBlocks = this.get('primaryDatasets') ||
	this.get('model.availableMapsTask._result') || 
	this.get('mapviewDatasets.content');
      dLog('datasetsBlocks()  using', 
	   this.get('primaryDatasets.length'),
	   this.get('model.availableMapsTask._result.length'),
	   this.get('mapviewDatasets.content.length'));
    }
    if (datasetsBlocks)
      datasetsBlocks =
      datasetsBlocks.filter((block) => !block.get('isCopy'));

    return datasetsBlocks;
  }),

  datasetsBlocksRefresh : 0,
  // datasets: [],

  servers : alias('apiServers.servers'),

  data: computed('filteredData', function() {
    let
    filteredData = this.get('filteredData'),
    combined = filteredData;
    console.log('data', filteredData);
    return combined;
  }),
  //----------------------------------------------------------------------------
  dataPre: computed('datasetsBlocks', 'datasetsBlocks.[]', 'filter', function() {
    let availableMaps = this.get('datasetsBlocks') || resolve([]);
    let filter = this.get('filter')
    dLog('dataPre', availableMaps, filter);
    // perform filtering according to selectedChr
    // let filtered = availableMaps //all
    if (filter == 'private') {
      let maps = availableMaps.filterBy('public', false)
      return maps
    } else if (filter == 'owner') {
      return availableMaps.filterBy('owner', true)
    } else {
      if (trace_dataTree > 2)
        availableMaps.then(function (value) { console.log('dataPre availableMaps ->', value); });
      return availableMaps;
    }
  }),
  /** @return the filterGroup if there is one, and it has a pattern. */
  definedFilterGroups : computed(
    'filterGroups', 'filterGroups.[]',
    'filterGroups.0.@each', 'filterGroupsChangeCounter',
    function () {
      let
        filterGroups = this.get('filterGroups')
        .filter((filterGroup) => {
          dLog('definedFilterGroups filterGroup', filterGroup);
          return filterGroup.get('defined');
        });
      return filterGroups;
    }),
  datasetFilterGroup :  computed(
    'definedFilterGroups.@each.applyDataset',
    function () {
      let filterGroups = this.get('definedFilterGroups')
        .filter((filterGroup) => filterGroup.get('applyDataset'));
      return filterGroups[0];
    }),
  blockFilterGroup :  computed(
    'definedFilterGroups.@each.applyBlock',
    function () {
      let filterGroups = this.get('definedFilterGroups')
        .filter((filterGroup) => filterGroup.get('applyBlock'));
      return filterGroups[0];
    }),
  /** @return true if a dataset filterGroup is defined and it is a filter not a grouping. */
  isDatasetFilter : computed('datasetFilterGroup', function () {
    let filterGroup = this.get('datasetFilterGroup'),
    isFilter = filterGroup && (filterGroup.filterOrGroup === 'filter');
    if (trace_dataTree > 2)
      console.log('isDatasetFilter', isFilter);
    return isFilter;
  }),
  /** @return result is downstream of filter and filterGroups */
  data : computed('dataPre', 'dataPre.[]', 'dataFG', 'isFilter',    function() {
    let
      /** The result of a filter is an array of datasets, whereas a grouping results in a hash.
       * The result of data() should be an array, so only use filterGroup if it is a filter.
       */
      isFilter = this.get('isFilter'),
    datasets = isFilter ? this.get('dataFG') : this.get('dataPre');
    // this.parentAndScope()
    if (trace_dataTree > 2)
      console.log('isFilter', isFilter, 'datasets', datasets);
    return datasets;
  }),
  dataEmpty: computed('datasets', 'datasets.length', 'datasets.[]', function() {
    let length = this.get('datasets.length'),
    nonEmpty = (length > 0);
    return ! nonEmpty;
  }),
  /* ------------------------------------------------------------------------ */
  /** group the data in : Dataset / Block
   * Used for datasets without a parent
   */

  /** datasets with a .parent, i.e. containing child data blocks */
  withParent: filter('data', function(dataset, index, array) {
    let parent = dataset.get('parent.content');
    if (trace_dataTree > 2)
      console.log('withParent', dataset._internalModel.__data, parent && parent._internalModel.__data);
    return parent;
  }),
  /** Names of all datasets - just for trace / devel, not used. */
  names : mapBy('data', 'name'),

  // parents are reference assemblies
  /** result of uniqBy is a single dataset which refers to each (parent)
   * dataset; just 1 child of each parent is in the result. */
  child1 : uniqBy('withParent', 'parentName'), // parent.name
  /** parents of child1(), i.e. all the parent datasets, just once each.  */
  parents : mapBy('child1', 'parent'),
  /** names of parents(). */
  parentNames : mapBy('parents', 'name'),
  /** The same as parents, but without being filtered by FG;
   * i.e. this does not change when the filterGroup changes.
   */
  parentsNotFG : computed('dataPre', function() {
    /** the same calculation as withParent -> child1 -> parents, starting from
     * dataPre instead of data
     */
    let dataPre = this.get('dataPre'),
    parentsNotFG = dataPre.then ?
      dataPre.then((a) => uniqParentsByName(a)) :
      uniqParentsByName(dataPre);

    function uniqParentsByName(array) {
      return array
    /* withParent : */ .filter(function(dataset, index, array) {
      return dataset.get('parent.content');
    })
    /* child1 :*/ .uniqBy('parentName')  // parent.name
    /* parents :*/ .mapBy('parent');
    }

    return parentsNotFG;
  }),
  /** _meta.types of parents(). */
  parentsTypes : computed('parentsNotFG', 'parentsNotFG.[]', function () {
    if (trace_dataTree > 5) {
      let withParent = this.get('withParent');
      if (withParent.then)
        withParent.then(function (withParent) { console.log('parentsTypes : withParent then', withParent); });
      else
        console.log('parentsTypes : withParent', withParent);

      let child1 = this.get('child1');
      if (child1.then)
        child1.then(function (child1) { console.log('parentsTypes : child1 then', child1); });
      else
        console.log('parentsTypes : child1', child1);

      let parents = this.get('parents');
      if (parents.then)
        parents.then(function (parents) { console.log('parentsTypes : parents then', parents); });
      else
        console.log('parentsTypes : parents', parents);
    }
    let
      parentsNotFG = this.get('parentsNotFG'),
    promise = parentsNotFG.then ? parentsNotFG.then(parentsByType) :
      resolve(parentsByType(parentsNotFG));
   function parentsByType(parents) {
     return parents.filterBy('_meta.type').uniqBy('_meta.type').mapBy('_meta.type'); }
    if (trace_dataTree > 5) {
      console.log('parents', this.get('parents'), 'parentsTypes', promise);
      console.log('withParent :', this.get('withParent'), this.get('child1'), this.get('parents'));
    }
    let me = this;
    if (trace_dataTree > 5)
      if (promise.then)
        promise.then(function (parentsTypes) { console.log('parentsTypes :', parentsTypes, me.get('withParent'), me.get('child1'), me.get('parents')); });
    return promise;
  }),
  /** Datasets without a .parent; maybe a reference assembly (genome) or a GM. */
  withoutParent: filter('data', function(dataset, index, array) {
    return ! dataset.get('parent.content');
  }),
  // these 3 CFs are non-essential, used in trace.
  withoutParentNames : mapBy('withoutParent', 'name'),
  parentsid : mapBy('parentsNonUnique', 'id'),
  // an alternate method to calculate parents: parentsUnique
  parentsNonUnique : mapBy('withParent', 'parent'),
  parentsUnique : uniqBy('parentsNonUnique', 'name'),
  /** for trace - checking parentsUnique(). */
  parentsUniqueNames : mapBy('parentsUnique', 'name'),

  // dataWithoutParent are genetic maps
  /** setDiff works on names, but not on computed properties, hence the need for parentsContent.
   * This works; only used as checking trace / devel.
   */
  dataWithoutParentNames : setDiff('withoutParentNames', 'parentNames'),
  parentsContent : mapBy('parents', 'content'),
  dataWithoutParent : setDiff('withoutParent', 'parentsContent'),
  /** Same result as dataWithoutParentNames; just for trace / checking. */
  dataWithoutParent0Names : mapBy('dataWithoutParent', 'name'),

  /** used by dataWithoutParent1 (i.e. the non-setDiff version) */
  parentsSet : computed('parentNames', function () {
    let parents = this.get('parentNames'),
    set = parents.reduce(function(result, value) { return result.add(value); }, new Set());
    return set;
  }),
  /** Alternative to dataWithoutParent, which is based on setDiff.
   * The setDiff version is working OK, after introducing parentsContent,
   * so this equivalent is not required.
   */
  dataWithoutParent1: computed('withoutParent.[]', 'parentsSet', 'parents', function () {
    return this.get('withoutParent')
      .filter((d,i,a) => this.datasetFilter(d,i,a));
  }),
  datasetFilter(dataset, index, array) {
    let parentsSet = this.get('parentsSet'),
    name = dataset.get('name'),
    found = parentsSet.has(name);
    if (index === 0)
    {
      console.log('dataWithoutParent', array, parentsSet, dataset);
    }
    console.log(dataset._internalModel.__data, index, name, found);
    return ! found;
  },

  /* ------------------------------------------------------------------------ */

  levelMeta : new WeakMap(),

  /** group all datasets by parent type
   * add tabs for those, FG can apply, so: 
   * -> dataParentTypedFG -> dataParentTypedFGTree
   */
  dataParentTyped : computed
  (
    // based on dataTyped()
    'dataPre',
    function() {
      let datasetsP = this.get('dataPre');
      let me = this,
      promise = datasetsP.then(function (datasets) {
        datasets = datasets.toArray();
        let dataTyped = {};
        for (let i=0; i < datasets.length; i++) {
          let d = datasets[i],
          typeName = d.get('parent._meta.type');
          if (! typeName)
          {
            if (trace_dataTree > 3)
              console.log('dataset without parent._meta.type', d.get('name'), d.get('parentName'));  // parent.name
          }
          else
          {
            if (! dataTyped[typeName]) {
              dataTyped[typeName] = [];
              me.levelMeta.set(dataTyped[typeName], 'Datasets');
            }
            dataTyped[typeName].push(d);
          }
        }
        dLog('dataParentTyped', dataTyped);
        return dataTyped;
      }),
      promiseP = DS.PromiseObject.create({ promise: promise });
      return  promiseP;
    }),



  /** group the data in : Parent / Scope / Block
   */
  dataTree : computed('data', 'dataTypedTreeFG', 'useFilterGroup',    function() {
    let
      filterGroup = this.get('datasetFilterGroup'),
    me = this,
    datasets;
    if (filterGroup) {
      /** dataTypedTreeFG is already a PromiseObject, but need to extract the
       * value .children */
      let promise = this.get('dataTypedTreeFG')
        .then( function (d) { return d.children; } );
      datasets =
        DS.PromiseObject.create({promise : promise });
    } else {
      let dataP = this.get('data');
      if (dataP ) {
        datasets =
          DS.PromiseObject.create({
            promise:
            dataP.then(function (data) {
              data = data.toArray();
              console.log('dataTree data', data);
              return me.parentAndScope(data, 'all');
            })
          });
      }
    }
    return datasets;
  }),
  /** @return promise of a hash */
  dataTypedTreeFG : computed(
    'dataTypedFG', 'parentsTypes',
    function() {
      return this.addParentAndScopeLevelsPromise('dataTypedFG');
    }),
  /** @return promise of a hash */
  dataParentTypedFGTree : computed(
    'dataParentTypedFG', 'parentsTypes',
    function() {
      return this.addParentAndScopeLevelsPromise('dataParentTypedFG');
    }),
  addParentAndScopeLevelsPromise : function (valueName) {
    let datasetGroupsP = this.get(valueName),
    me = this,
    parentsTypes = me.get('parentsTypes');
    if (! parentsTypes.then)
      parentsTypes = resolve(parentsTypes);
    let
      promise = all([datasetGroupsP, parentsTypes]).then(
        (dp) => addParentAndScopeLevels(dp[0], dp[1]));
    dLog('parentsTypes', parentsTypes);
    /** Given datasets grouped into tabs, add a grouping level for the parent of the datasets,
     * and a level for the scope of the blocks of the datasets.
     * (for those tabs for which it is enabled - e.g. children)
     * @param datasetGroups is grouped by dataset._meta.type tabs
     */
    function addParentAndScopeLevels(datasetGroups, parentsTypes) {
      if (trace_dataTree)
        dLog('datasetGroups', datasetGroups);
      let
        result = {};
      for (var key in datasetGroups) {
        if (datasetGroups.hasOwnProperty(key)) {
          let value = datasetGroups[key],
          /* value may be a hash of parents (by name) or groups thereof;
           * Each parent value is an array of datasets.
           * Process each parent value with ps.
           */

          ps = function (key, value) {
            let
              /** parents.indexOf(d) (in dataTyped()) also checks if a given value
               * is a parent, but in that case d is the Dataset object, whereas key
               * is the _meta.type (if a parent does not have _meta.type it does not have a tab named by type).
               */
              valueType = me.levelMeta.get(value),
            isParentType = parentsTypes.indexOf(key) >= 0,  // i.e. !== -1
            valueIsParent =  value.length && value[0].get('children.length'),
            isParent =  (valueType === 'Parent') || isParentType || valueIsParent;
            if (trace_dataTree > 1)
              console.log('addParentAndScopeLevels', key, value, valueType, isParentType, valueIsParent, isParent);

            let tabName = valueName + ':' + key;
            if (isParent || (key === 'children')) {
              value = me.parentAndScope(value, tabName);
              // done in parentAndScope(): me.levelMeta.set(value, 'Parents');
            }
            else {
              value = me.datasetsFilterBlocks(tabName, me.levelMeta, value);
            }
            return value;
          };
          let resultValue, dataTypeName = me.levelMeta.get(value),
          isGrouping = dataTypeName === 'Groups';
          if (isGrouping) {
            resultValue = mapHash(value, ps);
            /* resultValue has the same structure as the input value - Groups. */
            me.levelMeta.set(resultValue, dataTypeName);
          }
          else {
            resultValue = ps(key, value);
          }
          if (resultValue && resultValue.myGenome2) {
            console.log(value, 'resultValue', resultValue, dataTypeName, me.levelMeta.get(resultValue));
          }

          result[key] = resultValue;
        }
      }
      if (trace_dataTree)
        console.log('dataTypedTreeFG', result);
      if (trace_dataTree > 2)
        logV(me.levelMeta, result);
      return result;
    }
    let promiseObject =
      DS.PromiseObject.create({promise : promise });
    return promiseObject;
  },
  /** Split the datasets according to their dataset._meta.type,
   * or otherwise by whether the dataset has a parent or children.
   */
  dataTyped : computed(
    'dataPre',
    function() {
      let datasetsP = this.get('dataPre');
      let me = this,
      promise = datasetsP.then ?
        datasetsP.then((d) => typeDatasets(d)) :
        resolve(typeDatasets(datasetsP));
      function typeDatasets (datasets) {
        datasets = datasets.toArray();
        let dataTyped = {};
        let parents = me.get('parents')
          .map(function (p) { return p.content || p; });
        if (trace_dataTree > 1)
          dLog('parents', me.get('parents'), parents);
        for (let i=0; i < datasets.length; i++) {
          let d = datasets[i],
          typeName = d.get('_meta.type');
          /** If the dataset's _meta.type is the same as its parent's then only
           * show it under the parent.
           */
          let parentType = d.get('parent._meta.type');
          if (parentType === typeName)
            typeName = undefined;

          if (! typeName && me.get('enable_datatypeFromFamily')) {
            typeName = datatypeFromFamily(d);
            function datatypeFromFamily() {
              let typeName;
              let parent = d.get('parent');
              if (parent.hasOwnProperty('content'))
                parent = parent.content;
              if (parent)
                typeName = 'children';
              else
              {
                let hasChildren = parents.indexOf(d) >= 0;  // i.e. !== -1
                typeName = hasChildren ? 'references' : 'unrelated';
                console.log(hasChildren, typeName);
              }
              return typeName;
            }
          }
          if (! typeName)
          {
            if (trace_dataTree > 3)
              console.log('dataset without typeName', d.get('name'), d.get('_meta'));
          }
          else
          {
            if (! dataTyped[typeName])
              dataTyped[typeName] = [];
            dataTyped[typeName].push(d);
          }
        }
        dLog('dataTyped', dataTyped);

        // dataTyped['children'] = me.parentAndScope(dataTyped['children']);
        let levelMeta = me.levelMeta;
        function setType(typeName, template) {
          let d = dataTyped[typeName];
          if (d) {
            try { levelMeta.set(d, template); }
            catch (e) { console.log(typeName, template, d, e); debugger; }
          }
        }
        setType('children', 'Datasets');  // 'Parent'
        setType('references', 'Datasets');
        setType('unrelated', 'Datasets');

        return dataTyped;
      };
      let
      promiseP = DS.PromiseObject.create({ promise: promise });
      return  promiseP;
    }),
  /**
   * dataPre -> dataTyped ->
   * dataTypedFG CF -> hash by value, of datasets
   * -> dataTypedTreeFG -> plus mapToParentScope
   */
  dataTypedFG : computed(
    'dataTyped', 'useFilterGroup', 'datasetFilterGroup',
    function() {
      return this.applyFGs('dataTyped');
    }),
  dataParentTypedFG : computed(
    'dataParentTyped', 'useFilterGroup', 'datasetFilterGroup',
    function() {
      return this.applyFGs('dataParentTyped');
    }),
  /** Apply the filterGroups, if any.
   * Currently just 1 filterGroup is supported;
   * the design is mostly in place to support multiple.
   */
  applyFGs : function(valueName) {
    let
      dataTypedP = this.get(valueName),
    filterGroup = this.get('datasetFilterGroup'),
    me = this;
    if (filterGroup) {
      dataTypedP = dataTypedP.then(applyFGs);
      function applyFGs (dataTyped) {
        let typedFG = {};
        Object.entries(dataTyped).forEach(
          ([typeName, datasets]) => 
            {
              if (trace_dataTree)
                console.log(typeName, datasets);
              // toArray() is now done in dataTyped(), so not needed here
              if (dataTyped.content && datasets.toArray) {
                console.log('applyFGs toArray?');
                debugger;
                datasets = datasets.toArray();
              }
              /** Use valueName to prefix tabName index of filterMatched - since
               * the same type names will appear in dataTypedFG and
               * dataParentTypedFG.
               * filterMatched is looked up with the '*FG' value name prefix.
               */
              let tabName = valueName + 'FG:' + typeName;
              datasets = me.datasetFilter(datasets, filterGroup, tabName);
              typedFG[typeName] = datasets;
            }
        );
        return typedFG;
      }
    }
    return dataTypedP;
  },
  /**
   * dataFG CF -> hash by value, of datasets
   */
  dataFG : computed(
    'dataPre', 'datasetFilterGroup',
    function() {
      let datasetsP = this.get('dataPre'),
      filterGroup = this.get('datasetFilterGroup'),
      me = this;
      return datasetsP.then(function (datasets) {
        datasets = datasets.toArray();
        return me.datasetFilter(datasets, filterGroup, 'all');
      });
    }),

  /** Apply filterGroup to datasets, and return the result.
   * @param tabName the value of dataset._meta.type which datasets share, or 'all'.
   */
  datasetFilter(datasets, filterGroup, tabName) {
    /** argument checking : expect that filterGroup exists and defines a filter / grouping */
    if (! filterGroup || ! filterGroup.get('defined')) {
      console.log('datasetFilter incomplete filterGroup :', filterGroup);
      return [];
    }

    let
      unused1 = filterGroup && (trace_dataTree > 1) && dLog('dataFG filterGroup', filterGroup, filterGroup.filterOrGroup, filterGroup.pattern),
    /** datasets is an array of either datasets or blocks.  fieldScope and fieldNamespace are only applicable to blocks  */
    isDataset = datasets && datasets[0] && datasets[0].constructor.modelName === 'dataset',
    metaFieldName = 'Created',
    /** used in development */
    metaFilterDev = function(f) {
      let meta = f.get('_meta');
      if (trace_dataTree > 1)
        console.log('metaFilter', f.get('name'), meta);
      let v = f.get('_meta' + '.' + metaFieldName);
      if (v) {
        (v = v.split(', ')) && (v = v[0]);
      }
      else if (meta) {
        /** current test data doesn't have much meta, so match what is available.  */
        v = v || meta.variety || 
          meta.shortName || 
          meta.paths || 
          meta.year || 
          meta.source;
      }
      return v;
    },
    isFilter = filterGroup && (filterGroup.filterOrGroup === 'filter'),  //  else group
    /** apply filter/group fg to f
     * @return true/false if fg is a filter, otherwise the value to group on
     */
    metaFilterFG = function(f, fg) {
      let keyFields = [];
      if (fg.fieldName)
        keyFields.push('name');
      if (fg.fieldScope && ! isDataset)
        keyFields.push('scope');
      if (fg.fieldNamespace && ! isDataset)
        keyFields.push('namespace');
      if (fg.fieldMeta)
        keyFields.push('_meta');

      if (trace_dataTree > 1)
        console.log('metaFilter', f.get('name'));
      /** key : value pair which matches fg.pattern  */
      let key, value;
      let
        /** @return true if string a matches any of the patterns defined by fg.
         */
        match = function (a) {
          return fg.match(a);
        },
      valueToString = function(v) {
        let s =
          (typeof v === 'string') ? v :
          (typeof v === 'object') ? JSON.stringify(v) :
          '' + v;
        return s;
      };

      for (let i = 0; ! value && (i < keyFields.length); i++) {
        let fieldName = keyFields[i];
        let meta = f.get(fieldName);
        if (trace_dataTree > 2)
          console.log(fieldName, '\t: ', meta);
        if (typeof meta !== 'object')
        {
          /* it will be useful to be able to group by .name or .scope value;
           * use specificKey=true to signify this,
           * e.g. if pattern === fieldName, group by f.get[fieldName].
           * otherwise (normal case), don't match key, match by value.
           */
          value = matchField(f, fieldName, true);
        }
        else
        {
          for (let key1 in meta) {
            value = matchField(meta, key1, false);
            if (value)
              break;
          }
        }
        /** match against the key and/or value of meta[key1]
         * @param specificKey true for .name and .scope,  to indicate key implicitly matches.
         */
        function matchField(meta, key1, specificKey) {
          /** @param obj may be an Ember Object, or the value of e.g. its ._meta field. */
          function getValue(obj, key) {
            return (typeof meta.get === 'function') ?
              meta.get(key)
              : (meta.hasOwnProperty(key1) && meta[key]);
          }
          let value,
          rawValue = getValue(meta, key1);
          if (rawValue) {
            /** The value used for grouping should be a string.
             * The schema indicates that the values of .name and .scope are strings.
             * So we could apply valueToString() only when ! meta.get,
             * but structured fields in addition to ._meta could be added to keyFields[].
             */
            let value1 = valueToString(rawValue),
            matched =
              (specificKey ? ((fg.pattern == key1) || (fg.get('patterns').indexOf(key1) >= 0))
               : (fg.matchKey && match(key1))) ||
              (fg.matchValue && match(value1));
            if ((trace_dataTree > 1) && matched) {
              console.log(key1 + ' : ' + value1);
            }
            if (fg.isNegated && ! isFilter)
              matched = ! matched;
            if (matched) {
              key = key1;
              if (isFilter)
                value = true;
              else
                /*  value may be large/complex - maybe truncate long JSON. */
                value = value1;
            }
          }
          return value;
        }
      };
      if (fg.isNegated && isFilter)
        value = ! value;

      return value;
    },
    metaFilter = filterGroup.pattern !== metaFilterDev ?
      function (d) { return metaFilterFG(d, filterGroup); }
    : metaFilterDev,
    /** n is an array : [{key, values}, ..] */
    n = d3.nest()
      .key(metaFilter)
      .entries(datasets || []),
    /** parentAndScope() could be restructured as a key function, and used in d3-array.group(). */
    /** reduce nest to a Map, processing values with parentAndScope() */
    map2 = n.reduce(
      function (map, nestEntry) {
        let key = nestEntry.key,
        value = nestEntry.values;
        map.set(key, value);
        return map; },
      new Map()
    );
    /** if isFilter, result is an array, otherwise a hash */
    let hash = {};
    /* if isFilter, the matched values are within map2.get(true); this is the whole result. */
    if (isFilter) {
      // in n and map2  the keys are already strings, i.e. 'true' and 'undefined'
      let matched = map2.get('true');
      let filterMatched = this.get('filterMatched');
      if (isDataset) {
        filterMatched[tabName] = ! ! matched;
        if (trace_dataTree)
          console.log('filterMatched[', tabName, '] =', ! ! matched);
      }
      /** map the unmatched key : 'undefined' -> 'unmatched' */
      let unmatched = map2.get('undefined');
      /* for isFilter, result is an array, except if !matched && unmatched && !ignoreFilter,
       * in which case unmatched is (currently) added, with key 'unmatched'.
       * The 'unmatched' is mostly a devel feature, for checking the result,
       * and may be flagged out.
       */
      if (matched) {
        hash = matched;
        if (unmatched && showUnmatched)
          hash.push({'unmatched' : unmatched});
      }
      else if (unmatched)
      {
        /** @see filterMatched  */
        let ignoreFilter = isDataset;
        if (ignoreFilter)
          hash = unmatched;
        else if (showUnmatched)
          hash['unmatched'] = unmatched;
      }
    }
    // is grouping
    else if ((n.length === 1) && (n[0].key === 'undefined'))
    {
      /** if it is a grouping and nothing matches, then pass through unaltered. */
      let datasets = n[0].values;   /* i.e. map2['undefined']  */
      this.levelMeta.set(datasets, 'Datasets');
      hash = datasets;  // result type is an array of datasets in this case, not a hash.
    }
    else {
      this.levelMeta.set(hash, 'Groups');
      /** {{each}} of Map is yielding index instead of key, so convert Map to a hash */
      for (var [key, value] of map2) {
        if (trace_dataTree > 1)
          console.log(key, ' : ', value);
        if ((key === 'undefined') && showUnmatched)
          key = 'unmatched';
        if (key !== 'undefined') {
          hash[key] = value;
          this.levelMeta.set(value, 'Group');
        }
      }
    }
    if (trace_dataTree)
      console.log(tabName, n, isFilter, 'map2', map2, hash);
    return hash;
  },
  /** Given an array of datasets, group them by parent, then within each parent,
   * group by scope the blocks of the datasets of the parent.
   * @param tabName the value of dataset._meta.type which datasets share, or 'all'.
   * @param withParentOnly  false means also show datasets without parents
   * They are (currently) grouped in 'undefined'
   */
  parentAndScope(datasets, tabName, withParentOnly) {
    let
      me = this,
    levelMeta = this.get('levelMeta'),
    /** datasets may be : {unmatched: Array()} */
    withParent = datasets.filter ? datasets.filter(function(f) {
      /** f may be {unmatched: Array}, which can be skipped. */
      let p = f.get && f.get('parent.content');
      return p; }) : [],
    /** can update this .nest() to d3.group() */
    n = d3.nest()
    /* the key function will return undefined or null for datasets without parents, which will result in a key of 'undefined' or 'null'. */
      .key(function(f) { let p = f.get && f.get('parent'); return p ? p.get('name') : f.get('parentName'); })
      .entries(withParentOnly ? withParent : datasets);
    /** this reduce is mapping an array  [{key, values}, ..] to a hash {key : value, .. } */
    let grouped =
      n.reduce(
        function (result, datasetsByParent) {
          let key = datasetsByParent.key,
          values = datasetsByParent.values;
          /** hash: [scope] -> [blocks]. */
          if (trace_dataTree > 1)
            console.log('datasetsByParent', datasetsByParent);
          // as commented in .key() function above.
          if  ((key === 'undefined') || (key === 'null')) {
            /* datasets without parent - no change atm, just convert the nest to hash.
             * but possibly move the children up to be parallel to the parents.
             * i.e. merge datasetsByParent.values into result.
             */
            // can change this to return value, and move result2[name] = value; outside .reduce()
            // grouped =   // keys are added to grouped,  object refn is unchanged.
            values.reduce(
              function (result2, dataset) {
                // dataset may be {unmatched: Array(n)} - skip this
                if (! dataset.get) return result2;
                let
                  name = dataset.get('name'),
                /** children may be a DS.PromiseManyArray. It should be fulfilled by now. */
                children = dataset.get('children');
                if (children.content)
                  children = children.content;
                if (children.length) {
                  let 
                    value = me.datasetsToBlocksByScope(tabName, levelMeta, children);
                  me.levelMeta.set(value, 'Parent');
                  if (trace_dataTree > 1)
                    dLog('me.levelMeta.set(', value, 'Parent');
                  result2[name] = value;
                }
                else {
                  if (dataset.then)
                    dataset = DS.PromiseObject.create({ promise: dataset });
                  if (trace_dataTree > 1)
                  dLog(name, levelMeta, 'levelMeta.set(', dataset, 'Dataset');
                  levelMeta.set(dataset, 'Dataset');
                  result2[name] = dataset;
                }
                return result2;
              },
              result);
          }
          else
          {
            /** key is parent name */
            result[key] =
              me.datasetsToBlocksByScope(tabName, levelMeta, datasetsByParent.values);
          };
          return result;
        },
        {});
    if (trace_dataTree)
      console.log('parentAndScope', tabName, grouped);
    this.levelMeta.set(grouped, "Parents");
    return grouped;
  },
  /** Given an array of datasets, filter their blocks. */
  datasetsFilterBlocks(tabName, levelMeta, datasets) {
    // based on extract from parentAndScope(), could factor out a common function.
    let me = this;
    let result = 
      datasets.reduce(
        function (result2, dataset) {
          // dataset may be {unmatched: Array(n)} - skip this
          if (! dataset.get) return result2;
          let
            name = dataset.get('name');

          function filterBlocks(dataset) {
            return me.datasetFilterBlocks(tabName, dataset);
          }
          let blocks;
          if (dataset.isFulfilled) {
            dataset = dataset.get('content');
          } else if (dataset.then) {
            dataset = DS.PromiseObject.create({
              promise: dataset.then(function (dataset2) {
                let blocks = filterBlocks(dataset);
                console.log('datasetsFilterBlocks promise', dataset, name, blocks);
                return blocks;
              })
            });
          }
          else {
            blocks = filterBlocks(dataset);
          }
          if (trace_dataTree > 1)
            dLog(name, levelMeta, 'levelMeta.set(', blocks, 'Blocks');
          levelMeta.set(blocks, 'Blocks');
          result2[name] = blocks;
          return result2;
        },
        {});

    this.levelMeta.set(result, "Groups");

    return result;
  },
  /** Given a dataset, filter its blocks. */
  datasetFilterBlocks(tabName, dataset) {
    let me = this;
    let blocks = dataset.get('blocksOriginal').toArray();
    let filterMatched = me.get('filterMatched');
    let isFiltered = filterMatched[tabName];
    let filterGroup = me.get('blockFilterGroup');
    /* if filter, filter the blocks  */
    if (! isFiltered && filterGroup) {
      let
        isBlockFilter = filterGroup && (filterGroup.filterOrGroup === 'filter') &&
        (filterGroup.fieldScope || filterGroup.fieldNamespace);
      /* grouping not implemented for blocks */
      if (isBlockFilter) {
        let value = me.datasetFilter(blocks, filterGroup, tabName);
        if (value.length) {
          /** if there the last element of value[] is justUnmatched(), then excise it. */
          let last = value[value.length-1];
          if (justUnmatched(last)) {
            console.log('justUnmatched', last, value);
            let unmatched = value.splice(value.length-1, 1);
            console.log('after splice', value, unmatched);
          }
        }
        if (value && value.length)
          blocks = value;
        else {
          if (trace_dataTree)
          dLog('isBlockFilter', blocks, filterGroup, value);
          blocks = [];
        }
      }
    }
    return blocks;
  },
  /** Given an array of datasets, group their blocks by the scope of the blocks. */
  datasetsToBlocksByScope(tabName, levelMeta, datasets) {
    let me = this;
    let scopes = 
      datasets.reduce(function (blocksByScope, dataset) {
        if (trace_dataTree > 2)
          console.log('blocksByScope', blocksByScope, dataset);
        /** Within a parent, for each dataset of that parent,
         * reference all the blocks of dataset, by their scope.  */
        let blocks = me.datasetFilterBlocks(tabName, dataset);
        /* group the (filtered) blocks by the scope of the blocks. */
        blocks.forEach(
          function (b) {
            // b may be : {unmatched: Array()} - skip it
            if (b && b.get) {
              let scope = b.get('scope'),
              newScope = function () { let s = []; levelMeta.set(s, "Scope"); return s; },
              blocksOfScope = blocksByScope[scope] || (blocksByScope[scope] = newScope());
              blocksOfScope.push(b);
              levelMeta.set(b, "Blocks");
            }
          });
        return blocksByScope;
      }, {});
    levelMeta.set(scopes, "Scopes");
    return scopes;
  },

  //----------------------------------------------------------------------------
  actions: {

    /** Show the new-datasource-modal, enabling the user to add a new api server.
     * This action is also available within form/api-servers.js (addNewDatasource() is identical).
     */
    addNewDatasource() {
      $('#new-datasource-modal').modal('show');
    },

    serverTabSelected(tabId, apiServerName, apiServer) {
      console.log('serverTabSelected', tabId, apiServerName, apiServer);
      this.set('serverTabSelected', apiServerName);
      /* 1-way flow: manage-explorer -> controls.serverTabSelected -> other modules */
      this.set('controls.serverTabSelected', apiServerName);
    },
    receivedDatasets(datasetsHandle, blockValues) {
      console.log('receivedDatasets', datasetsHandle, blockValues);
      this.incrementProperty('datasetsBlocksRefresh');
    },

    /** invoked from hbs via {{compute (action "datasetTypeTabId" datasetType ) }}
     * @return string suitable for naming a html tab, based on datasetType name.
     */
    datasetTypeTabId : datasetTypeTabId,

    /** Triggered by refresh icon on datset list **/
    refreshAvailable() {
      this.refreshAvailable(); // See method function above
    },
    deleteBlock(chr) {
      this.sendAction('deleteBlock', chr.id);
    },
    changeFilter: function(f) {
      this.set('filter', f)
    },
    filterGroupsChanged : function(fg) {
      /* note : fg === this.get('filterGroups.0')
       */
      if (trace_dataTree)
        dLog('filterGroupsChanged', fg, this.get('filterGroups.0'), this.get('filterGroups.0'), this.get('filterGroups.0.isCaseSensitive'));
      // Wait for update of values of fg which are bound input elements.
      let me = this;
      later(function () {
        dLog('filterGroupsChanged later', fg, me.get('filterGroups.0'), me.get('filterGroups.0'), me.get('filterGroups.0.isCaseSensitive'));
        me.incrementProperty('filterGroupsChangeCounter');
      });
    },
    onDelete(modelName, id) {
      this.refreshAvailable();
      this.sendAction('onDelete', modelName, id);
    },
    /** The user has clicked + to add a block.
     * If the block's dataset has a .parentName and doesn't have a
     * referenceBlock on the same server, or a referenceBlock which is viewed,
     * then show a dialog listing potential reference blocks which the user may add.
     */
    loadBlock(block) {
      /** if block is not a child and there is already a viewed reference with
       * the same dataset id, then show a dialog.
       */
      let duplicates;
      if (! block.get('datasetId.parentName') &&
          (duplicates = block.viewedReferenceBlockDup()) &&
          duplicates.length)
      {
        this.set('viewedSynonomousReferenceBlocks', duplicates);
      }
      else if (! block.get('datasetId.parentName') || 
          block.get('referenceBlock') ||
          block.referenceBlockSameServer()) {
        // mapview : loadBlock() will view the reference if it is not viewed.
        this.sendAction('loadBlock', block);
      }
      else
        this.set('blockWithoutParentOnPrimary', block);

      /** If the user is adding a reference then check if
       * .blockWithoutParentOnPrimary is now able to be added, and add it.
       */
      next(() => {
        if (! block.get('datasetId.parentName')) {
          let dataBlock = this.get('blockWithoutParentOnPrimary'),
          referenceBlock = dataBlock && dataBlock.get('referenceBlock');
          if (referenceBlock) {
            dLog('loadBlock viewing', dataBlock.id, 'as its referenceBlock', referenceBlock.id, 'is viewed');
            this.set('blockWithoutParentOnPrimary', null);
            this.sendAction('loadBlock', dataBlock);
          }
        }
      });
    }

  },  // actions

  //----------------------------------------------------------------------------

  /** If a tab is active (selected), save its id.  */
  willRender () {
    let
      explorerDiv = $(selectorExplorer),
    /** active tab element.  Its child <a> href is '#'+id, but it is easier to
     * extract id from the content div id. */
    t = explorerDiv.find(' li.active-detail.active'),
    /** active content element */
    c = explorerDiv.find(' div.tab-content > .active '),
    id = c[0] && c[0].id;
    if (id) {
      this.set('activeId', id);
      if (trace_dataTree > 2)
        console.log('willRender', id, t[0], c[0]);
    }
  },
  /** For those tabs generated from data, after re-render the active class is lost.
   * So re-add class .active to the tab header and content elements.
   * this.activeId is recorded in willRender().
   */
  didRender () {
    let
      id = this.get('activeId');
    if (id) {
      let
        /** didRender() is called several times during the render, and c.length
         * and t.length will be 0 on some of these initial calls.  In which case
         * the .addClass() does nothing.
         *
         * It is possible that didRender() is called after .addClass() has been
         * done, or when c and a already have their .active class; in this case
         * also .addClass() has no effect, and is probably as quick as checking
         * if they have the class.
         */
        c = $(selectorExplorer + ' div.tab-content > #' + id);
      c.addClass('active');

      let
        /** <a> whose href matches activeId. */
        a = $('li.active-detail > a[href="#' + id + '"]'),
      /** tab element containing a.  Ensure this has .active */
      t = a.parent();
      t.addClass('active');

      if (c.length)
        if (trace_dataTree > 2)
          console.log('didRender', id, c[0], t[0], a[0]);
    }
  },
  willDestroyElement() {
    console.log('willDestroyElement', this);
    this._super(...arguments);
  }
  //----------------------------------------------------------------------------

});
