import $ from 'jquery';
import Component from '@ember/component';
import { observer } from '@ember/object';

import { eltClassName } from '../utils/domElements';

import config from '../config/environment';

/* global d3 */
/* global Handsontable */

const trace = 0;
const dLog = console.debug;

export default Component.extend({

  actions : {

    /**
     * @param d array of e.g.
     * {Chromosome: "599bca87501547126adea117", Feature: "featureL", Position: "1.2"}
     */
    showData : function(d)
    {
      if (trace)
        dLog("showData", d);
      let table = this.get('table');
      if (table)
      {
        /** filter out empty rows in d[] */
        let data = d.filter(function(d1) { return d1.Chromosome; });
        table.loadData(data);
      }
    }

  },


  didInsertElement() {
    dLog("components/table-brushed.js: didInsertElement");
  },

  /** Destroy the HandsOnTable so that it does not clash with the HandsOnTable
   * created by paths-table.
   */
  willDestroyElement() {
    let table = this.get('table');
    if (table) {
      dLog('willDestroyElement', table);
      table.destroy();
      this.set('table', undefined);
    }

    this._super(...arguments);
  },


  didRender() {
    dLog("components/table-brushed.js: didRender");
    let table = this.get('table');
    if (table === undefined)
      this.get('createTable').apply(this);
  },

  createTable: function() {
    var that = this;
    dLog("createTable", this);

    let tableDiv = $("#table-brushed")[0];
    dLog("tableDiv", tableDiv);
      var table = new Handsontable(tableDiv, {
        data: this.get('data') || [['', '', '']],
        minRows: 1,
        rowHeaders: true,
        columns: [
          {
            data: 'Chromosome',
            type: 'text'
          },
          {
            data: 'Feature',
            type: 'text'
          },
          {
            data: 'Position',
            type: 'numeric',
            numericFormat: {
              pattern: '0,0.*'
            }
          }
        ],
        colHeaders: [
          '<span title = "e.g. chromosome or linkage group">Block</span>',
          '<span title = "e.g. marker / gene">Feature</span>',
          'Position'
        ],
        headerTooltips: true,
        colWidths: [100, 135, 60],
        height: 600,
        manualRowResize: true,
        manualColumnResize: true,
        manualRowMove: true,
        // manualColumnMove: true,
        copyPaste: {
          /** increase the limit on copy/paste.  default is 1000 rows. */
          rowsLimit: 10000
        },
        contextMenu: true,
        sortIndicator: true,
        columnSorting: {
          column: 2,
          sortOrder: true
        },
        /* see comment re. handsOnTableLicenseKey in frontend/config/environment.js */
        licenseKey: config.handsOnTableLicenseKey
      });
      that.set('table', table);
      $("#table-brushed").on('mouseleave', function(e) {
        that.highlightFeature();
      }).on("mouseover", function(e) {
        if (e.target.tagName == "TD") {
          var tr = e.target.parentNode;
          if (tr.childNodes[2]) {
            var feature_name = $(tr.childNodes[2]).text();
            if (feature_name.indexOf(" ") == -1) {
              that.highlightFeature(feature_name);
              return;
            }
          }
        }
        that.highlightFeature();
      });
  },


  onSelectionChange: observer('data', function () {
    let data = this.get('data'),
    me = this,
    table = this.get('table');
    if (table)
    {
      if (trace)
        dLog("table-brushed.js", "onSelectionChange", table, data.length);
      me.send('showData', data);
      table.updateSettings({data:data});
    }
  }),

  highlightFeature: function(feature) {
    d3.selection.prototype.moveToFront = function() {
      return this.each(function(){
        this.parentNode.appendChild(this);
      });
    };
    d3.selectAll("g.axis-outer > circle")
      .attr("r", 2)
      .style("fill", "red")
      .style("stroke", "red");
    if (feature) {
      /** see also handleFeatureCircleMouseOver(). */
      d3.selectAll("g.axis-outer > circle." + eltClassName(feature))
        .attr("r", 5)
        .style("fill", "yellow")
        .style("stroke", "black")
        .moveToFront();
    }
  }


});
