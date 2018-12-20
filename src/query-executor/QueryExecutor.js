/* file : QueryExecutor.js
MIT License

Copyright (c) 2018 Thomas Minier

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

'use strict'
import React, { Component } from 'react'
import ReactTable from 'react-table'
import 'react-table/react-table.css'
import protobuf from 'protobufjs'
import Chart from 'chart.js'
import ReactDOM from 'react-dom'

const BUCKET_SIZE = 20
const REACT_TABLE_PAGE_SIZE = 10

/**
 * Execute SPARQL queries suing a Sage client and display results in a paginated table
 * @extends Component
 * @author Thomas Minier
 */
class QueryExecutor extends Component {
  constructor (props) {
    super(props)
    this.currentIterator = null
    this.diefChart = null;
    this.xp = "Timestamp,Scan,First Join, Last Join (Avg), Last Join (Max);\n";
    this.listener = x => {
      const now = Date.now()

      if (this.state.readyToRender) {
        this.state.readyToRender = false;
        var canvas = ReactDOM.findDOMNode(this.refs.diefChart);
        var ctx = canvas.getContext("2d");
        this.diefChart = new Chart(ctx,{
              type: "scatter",
              beginAtZero: true,
              data: this.state.data,
              options: this.state.options
          });
      }

      // update clock
      this.setState({
        executionTime: (now - this.startTime) / 1000,
        httpCalls: this.spy.nbHTTPCalls,
        avgServerTime: this.spy.avgResponseTime,
        history: this.state.history.concat([{
          x: (now - this.startTime) / 1000,
          y: this.spy.avgResponseTime
        }])
      })

      var lastData = this.answerGraph[this.answerGraph.length - 1];
      // this.state.data.datasets[0].data.push({x:lastData[0],y:lastData[1]});
      // this.diefChart.update();

      // store results and render them by batch
      this.bucket.push(x)
      if (this.warmup) {
        this.setState({
          columns: Object.keys(x).map(k => {
            return {
              Header: k,
              accessor: k,
              // render URIs as external links
              Cell: row => {
                if (row.value !== null && row.value.startsWith('http')) {
                  return (<a href={row.value} target='_blank'>{row.value}</a>)
                }
                return (<span>{row.value}</span>)
              }
            }
          })
        })
        this.warmup = false
      }
      if (this.bucket.length >= BUCKET_SIZE) {
        this.setState({
          results: this.state.results.concat(this.bucket)
        })
        this.bucket = []
      }
      var answerCount = this.bucket.length + this.state.results.length;
      this.answerGraph.push([((now-this.startTime)/1000),answerCount]);
      var dief = this.evalDiefficiency();
      this.setState({
        diefficiency: dief
      })
    }
    this.state = {
      results: [],
      columns: [],
      history: [],
      executionTime: 0,
      httpCalls: 0,
      readyToRender: false,
      data: {
       datasets: [
         {
           label: "Number of results produced over time",
           showLine: true,
           backgroundColor: "rgba(63,127,191,0.2)",
           pointBackgroundColor: "rgba(63,127,191,1)",
           borderColor: "rgba(63,127,191,0.6)",
           pointHoverBackgroundColor: "rgba(63,127,191,1)",
           pointHoverBorderColor: "rgba(63,127,191,1)",
           data: []
         }
       ]
     },
     options: {
       ///Boolean - Whether grid lines are shown across the chart
       scaleShowGridLines : true,
       //String - Colour of the grid lines
       scaleGridLineColor : "rgba(0,0,0,.05)",
       //Number - Width of the grid lines
       scaleGridLineWidth : 1,
       //Boolean - Whether to show horizontal lines (except X axis)
       scaleShowHorizontalLines: true,
       //Boolean - Whether to show vertical lines (except Y axis)
       scaleShowVerticalLines: true,
       //Boolean - Whether the line is curved between points
       bezierCurve : true,
       //Number - Tension of the bezier curve between points
       bezierCurveTension : 0.4,
       //Boolean - Whether to show a dot for each point
       pointDot : true,
       //Number - Radius of each point dot in pixels
       pointDotRadius : 4,
       //Number - Pixel width of point dot stroke
       pointDotStrokeWidth : 1,
       //Number - amount extra to add to the radius to cater for hit detection outside the drawn point
       pointHitDetectionRadius : 20,
       //Boolean - Whether to show a stroke for datasets
       datasetStroke : true,
       //Number - Pixel width of dataset stroke
       datasetStrokeWidth : 2,
       //Boolean - Whether to fill the dataset with a colour
       datasetFill : true,
       //Boolean - Whether to horizontally center the label and point dot inside the grid
       offsetGridLines : false,
       scales: {
                  xAxes: [{
                      display: true,
                      type: 'linear',
                      ticks: {
                          autoSkip: true,
                          maxTicksLimit: 10
                      }
                  }],
               yAxes: [{
                   ticks: {
                       beginAtZero: true,
                   }
               }]
           }
     },
      avgServerTime: 0,
      diefficiency: 0,
      timeLeft: null,
      newTimeLeft: null,
      lastTimeLeftAvg: null,
      lastTimeLeftMax: null,
      newTimeTotal: null,
      lastTimeTotalAvg: null,
      lastTimeTotalMax: null,
      callEstimate: null,
      errorMessage: null,
      isRunning: false,
      showTable: false,
      hasError: false,
      pauseText: 'Pause'
    }
    this.answerGraph = [[0,0]];
    this.execute = this.execute.bind(this)
    this.stopExecution = this.stopExecution.bind(this)
    this.pauseExecution = this.pauseExecution.bind(this)
  }

  render () {
    return (
      <div className='QueryExecutor'>
      <script src="node_modules/chart.js/dist/Chart.bundle.js"></script>
        <div className='row'>
          <div className='col-md-12'>
            <br/>
            {this.state.isRunning ? (
              <div>
                <button className='btn btn-warning' onClick={this.pauseExecution}>{this.state.pauseText}</button>
                <span>{' '}<button className='btn btn-danger' onClick={this.stopExecution}>Stop</button></span>
              </div>
            ) : (
              <button className='btn btn-primary' onClick={this.execute}>Execute</button>
            )}
            {this.state.hasError ? (
              <div className='alert alert-danger alert-dismissible fade show' role='alert'>
                <strong>Error:</strong> {this.state.errorMessage}
                <button type='button' className='close' data-dismiss='alert' aria-label='Close'>
                  <span aria-hidden='true'>&times;</span>
                </button>
              </div>
            ) : (null)}
          </div>
        </div>
        {this.state.showTable ? (
          <div>
            <div className='row'>
              <div className='col-md-12'>
                <br/>
                <h3><i className='fas fa-chart-bar' /> Real-time Statistics</h3>
                {this.state.timeLeft ? <h5>Estimated remaining time : {this.state.timeLeft}</h5> : (null)}
                {this.state.newTimeLeft ? <h5>[FIRST-JOIN] Estimated remaining time : {this.state.newTimeLeft}</h5> : (null)}
                {this.state.newTimeTotal ? <h5>[FIRST-JOIN] Estimated execution time : {this.state.newTimeTotal}</h5> : (null)}
                {this.state.lastTimeLeftAvg ? <h5>[LAST-JOIN/AVG] Estimated remaining time : {this.state.lastTimeLeftAvg}</h5> : (null)}
                {this.state.lastTimeTotalAvg ? <h5>[LAST-JOIN/AVG] Estimated execution time : {this.state.lastTimeTotalAvg}</h5> : (null)}
                {this.state.lastTimeLeftMax ? <h5>[LAST-JOIN/MAX] Estimated remaining time : {this.state.lastTimeLeftMax}</h5> : (null)}
                {this.state.lastTimeTotalMax ? <h5>[LAST-JOIN/MAX] Estimated execution time : {this.state.lastTimeTotalMax}</h5> : (null)}
                {this.state.callEstimate ? <h5>Estimated HTTP call number : {this.state.callEstimate}</h5> : (null)}
                <table className='table'>
                  <thead>
                    <tr>
                      <th style={{'vertical-align': 'middle'}}>Execution time</th>
                      <th style={{'vertical-align': 'middle'}}>HTTP requests</th>
                      <th style={{'vertical-align': 'middle'}}>Number of results</th>
                      <th style={{'vertical-align': 'middle'}}>Avg. HTTP response time</th>
                      <th style={{'vertical-align': 'middle'}}>Server Diefficiency &nbsp;

                      <button data-toggle="modal" data-target="#modChart" className='btn btn-info'>Show&nbsp;<i className='fas fa-chart-line' />
                      </button>

                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{this.state.executionTime} s</td>
                      <td>{this.state.httpCalls} requests</td>
                      <td>{this.state.results.length} solution mappings</td>
                      <td>{Math.floor(this.state.avgServerTime)} ms</td>
                      <td>{this.state.diefficiency}</td>
                    </tr>
                  </tbody>
                </table>
                <button className='btn btn-warning' data-toggle="collapse" data-target="#logs">Open execution logs</button>
                <br/>
                <div id="logs" class="collapse">
                  <br/>
                  <pre>
                  {this.state.execLogs}
                  </pre>
                </div>
                <br/>
              </div>
            </div>
              <div class="modal fade" id="modChart" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
              <div class="modal-dialog" style={{'margin-left':'10%','margin-right':'10%','max-width':'80%'}}>
                  <div class="modal-content">
                      <div class="modal-header">
                          <h5>Diefficiency Chart</h5>
                          <button type="button" class="close" data-dismiss="modal">
                              <span aria-hidden="true">&times;</span><span class="sr-only">Close</span>
                          </button>
                      </div>
                      <div class="modal-body">
                          <canvas id="diefChart" ref="diefChart" width="100%" height="35%"></canvas>
                      </div>
                  </div>
              </div>
          </div>
            <div className='row'>
              <div className='col-md-12'>
                <h3><i className='fas fa-list-ul' /> Query results</h3>
                <ReactTable
                  sortable={false}
                  className='-striped'
                  data={this.state.results}
                  columns={this.state.columns}
                  defaultPageSize={REACT_TABLE_PAGE_SIZE}
                  noDataText='No mappings found'
                />
              </div>
            </div>
          </div>
        ) : (null)}
      </div>
    )
  }

  resetState () {
    this.currentIterator = null
    this.setState({
      results: [],
      columns: [],
      history: [],
      executionTime: 0,
      avgServerTime: 0,
      httpCalls: 0,
      readyToRender: false,
      data: {
       datasets: [
         {
           label: "Number of results produced over time",
           showLine: true,
           backgroundColor: "rgba(63,127,191,0.2)",
           pointBackgroundColor: "rgba(63,127,191,1)",
           borderColor: "rgba(63,127,191,0.6)",
           pointHoverBackgroundColor: "rgba(63,127,191,1)",
           pointHoverBorderColor: "rgba(63,127,191,1)",
           data: []
         }
       ]
     },
     options: {
       ///Boolean - Whether grid lines are shown across the chart
       scaleShowGridLines : true,
       //String - Colour of the grid lines
       scaleGridLineColor : "rgba(0,0,0,.05)",
       //Number - Width of the grid lines
       scaleGridLineWidth : 1,
       //Boolean - Whether to show horizontal lines (except X axis)
       scaleShowHorizontalLines: true,
       //Boolean - Whether to show vertical lines (except Y axis)
       scaleShowVerticalLines: true,
       //Boolean - Whether the line is curved between points
       bezierCurve : true,
       //Number - Tension of the bezier curve between points
       bezierCurveTension : 0.4,
       //Boolean - Whether to show a dot for each point
       pointDot : true,
       //Number - Radius of each point dot in pixels
       pointDotRadius : 4,
       //Number - Pixel width of point dot stroke
       pointDotStrokeWidth : 1,
       //Number - amount extra to add to the radius to cater for hit detection outside the drawn point
       pointHitDetectionRadius : 20,
       //Boolean - Whether to show a stroke for datasets
       datasetStroke : true,
       //Number - Pixel width of dataset stroke
       datasetStrokeWidth : 2,
       //Boolean - Whether to fill the dataset with a colour
       datasetFill : true,
       //Boolean - Whether to horizontally center the label and point dot inside the grid
       offsetGridLines : false,
       scales: {
         xAxes: [{
             display: true,
             scaleLabel: {
               display: true,
               labelString: 'Time (seconds)'
             }
         }],
         yAxes: [{
             ticks: {
                 beginAtZero: true,
             },
             scaleLabel: {
               display: true,
               labelString: 'Results produced'
             }
         }]
       }
     },
      diefficiency: 0,
      timeLeft: null,
      newTimeLeft: null,
      lastTimeLeftAvg: null,
      lastTimeLeftMax: null,
      newTimeTotal: null,
      lastTimeTotalAvg: null,
      lastTimeTotalMax: null,
      callEstimate: null,
      execLogs: "No response yet",
      errorMessage: '',
      hasError: false,
      pauseText: 'Pause'
    })
    if (this.diefChart != null) {
      this.diefChart.destroy();
    }
    this.answerGraph = [[0,0]];
  }

  stopExecution () {
    if (this.currentIterator != null) {
      this.currentIterator.close()
    }
    this.setState({
      isRunning: false
    })
  }

  pauseExecution () {
    if (this.state.pauseText === 'Pause') {
      this.currentIterator.removeListener('data', this.listener)
      this.setState({
        pauseText: 'Resume'
      })
    } else {
      this._readIterator()
      this.setState({
        pauseText: 'Pause'
      })
    }
  }

  _readIterator () {
    if (this.currentIterator !== null) {
      this.currentIterator.on('data', this.listener)
    }
  }

  evalDiefficiency (){
    var dief = this.state.diefficiency;
    var i = this.answerGraph.length - 1;
    var prevX = this.answerGraph[i-1][0];
    var prevY = this.answerGraph[i-1][1];
    var currX = this.answerGraph[i][0];
    var currY = this.answerGraph[i][1];
    var area = ((currX-prevX) * prevY) + (((currX-prevX) * (currY - prevY))/2);
    return Math.round((dief + area) * 100) / 100 ;
  }

  execute () {
    try {
      this.stopExecution()
      this.resetState()
      this.spy = new sage.Spy()
      let client = new sage.SageClient(this.props.url, this.spy)
      this._stubRequestClient(client)
      this.currentIterator = client.execute(this.props.query)
      this.setState({
        isRunning: true,
        showTable: true,
        readyToRender: true
      })
      this.bucket = []
      this.warmup = true
      this.startTime = Date.now()
      this.currentIterator.on('error', err => {
        console.error(err)
        this.setState({
          errorMessage: err.message,
          isRunning: false,
          hasError: true
        })
      })

      this.currentIterator.on('end', () => {
        const now = Date.now()
        // update clock
        this.setState({
          executionTime: (now - this.startTime) / 1000
        })
        this.xp += this.state.executionTime;
        console.log(this.xp);
        this.xp = "Scan,First Join, Last Join (Avg), Last Join (Max);";
        this.setState({
          results: this.state.results.concat(this.bucket)
        })
        this.setState({
          isRunning: false
        })
        this.answerGraph.push([((now-this.startTime)/1000),this.state.results.length]);
        var dief = this.evalDiefficiency();
        this.setState({
          diefficiency: dief
        })

      })
      this._readIterator()
    } catch (e) {
      this.setState({
        errorMessage: e.message,
        isRunning: false,
        hasError: true
      })
    }
  }




  secondsToHms(d) {
      d = Number(d);
      var h = Math.floor(d / 3600);
      var m = Math.floor(d % 3600 / 60);
      var s = Math.floor(d % 3600 % 60);

      var hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : "";
      var mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : "";
      var sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
      return hDisplay + mDisplay + sDisplay;
  }


  /**
  * Takes the execution tree and transforms it into a list of nodes ordered from bottom to top
  */
  treeToList(execTree){
    var current = execTree.projSource;
    var nodeList = [];
    while (current.joinSource != undefined) {
      nodeList.push(current.joinSource);
      current = current.joinSource;
    }
    current.scanSource.estimatedCardAvg = current.scanSource.cardinality;
    current.scanSource.estimatedCardMax = current.scanSource.cardinality;
    nodeList.push(current.scanSource);
    return nodeList.reverse();
  }

  /**
   * Stub the HTTP client to measure HTTP requests
   */
  _stubRequestClient (sageClient) {
    const sendRequest = sageClient._graph._httpClient._httpClient.post
    sageClient._graph._httpClient._httpClient.post = (params, cb) => {
      sendRequest(params, (err, res, body) => {
        const now = Date.now()
        var next = body.next;
        this.setState({
          executionTime: (now - this.startTime) / 1000,
          httpCalls: this.spy.nbHTTPCalls,
          avgServerTime: this.spy.avgResponseTime
        })
        if (next != null) {
          var jsonDescriptor = require("../protobuf/iterators.json");
          var root = protobuf.Root.fromJSON(jsonDescriptor);
          var iterators = root.lookup("iterators");
          var nsr=iterators.RootTree.decode(Buffer.from(next,'base64'));
          var treeText = JSON.stringify(nsr, null, 2);

          var listTree = this.treeToList(nsr);
          for (var i = 1; i < listTree.length; i++) {
            var curr = listTree[i];
            var prev = listTree[i-1];
            curr.estimatedCardAvg = (prev.estimatedCardAvg - curr.mucNumber) * (curr.loopCardTotal/curr.mucNumber) + curr.loopCardTotal;

            curr.estimatedCardMax = (prev.estimatedCardMax - curr.mucNumber) * curr.maxInnerCard + curr.loopCardTotal;
          }
          var joinSource;
          if (listTree.length > 1) {
            joinSource = listTree[1];
          }
          var scanSource = listTree[0];

          var lastJoin = listTree[listTree.length-1];
          var loopCpt = 2;
          while (lastJoin.estimatedCardMax == 0) {
            lastJoin = listTree[listTree.length-loopCpt]
            loopCpt++;
          }
          var lastJoinSpeed = parseInt(lastJoin.loopOffsetTotal) / this.state.executionTime
          var lastJoinTimeEstimateAvg = lastJoin.estimatedCardAvg / lastJoinSpeed;
          var lastJoinTimeEstimateMax = lastJoin.estimatedCardMax / lastJoinSpeed;
          var card = parseInt(scanSource.cardinality);
          var offset = parseInt(scanSource.offset);
          var estimate = ((card - offset)* this.state.executionTime) / offset;
          if (joinSource != null) {
            var joinSpeed = (parseInt(joinSource.loopOffsetTotal)  / this.state.executionTime)
            var joinCardEstimate = (parseInt(joinSource.loopCardTotal) / parseInt(joinSource.mucNumber)) * card
            var timeEstimateJoin = joinCardEstimate / joinSpeed;
          }
          var nbCall = (this.state.httpCalls * card) / offset;
          var timeEstimateScan = (card * this.state.executionTime) / offset;

          this.xp += this.state.executionTime + "," + parseInt(timeEstimateScan) + "," + parseInt(timeEstimateJoin) + "," + parseInt(lastJoinTimeEstimateAvg) + "," + parseInt(lastJoinTimeEstimateMax) + ";\n"

          this.setState({
            execLogs: treeText,
            timeLeft: this.secondsToHms(estimate),
            newTimeLeft: this.secondsToHms(timeEstimateJoin - this.state.executionTime),
            lastTimeLeftAvg: this.secondsToHms(lastJoinTimeEstimateAvg - this.state.executionTime),
            lastTimeLeftMax: this.secondsToHms(lastJoinTimeEstimateMax - this.state.executionTime),
            newTimeTotal: this.secondsToHms(timeEstimateJoin),
            lastTimeTotalAvg: this.secondsToHms(lastJoinTimeEstimateAvg),
            lastTimeTotalMax: this.secondsToHms(lastJoinTimeEstimateMax),
            callEstimate: parseInt(nbCall)
          })
        }

        cb(err, res, body)
      })
    }
  }
}

export default QueryExecutor
