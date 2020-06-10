import { Injectable } from '@angular/core';
import * as _ from 'lodash-es';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { UUID } from 'angular2-uuid';
import { Observable, throwError, forkJoin } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AzureFileUploaderService {

  maxBlockSize;
  numberOfBlocks = 1;
  selectedFile = null;
  currentFilePointer = 0;
  totalBytesRemaining = 0;
  blockIds = [];
  blockIdPrefix = 'block-';
  bytesUploaded = 0;
  signedURL = null;
  azurObserver;
  fileReqBlocks = [];
  reader = new FileReader();
  timeStarted;
  constructor(
    private httpClient: HttpClient
  ) { }


  uploadToBlob(signedURL: string, file: any) {
    this.signedURL = signedURL;
    this.selectedFile = file;
    return new Observable((observer) => {
      this.azurObserver = observer;
      this.handleFileSelect();
    });
  }

  handleFileSelect() {
    this.timeStarted = new Date();
    this.fileReqBlocks = [];
    this.currentFilePointer = 0;
    this.bytesUploaded = 0;
    this.maxBlockSize = 1 * 1024 * 1024; // Each file will be split in 50 MB.
    this.blockIds = [];
    const fileSize = this.selectedFile.size;
    console.log('fileSize::::', fileSize);
    if (fileSize < this.maxBlockSize) {
      this.maxBlockSize = fileSize;
      console.log('max block size = ' + this.maxBlockSize);
    }
    this.totalBytesRemaining = fileSize;
    if (fileSize % this.maxBlockSize === 0) {
      this.numberOfBlocks = fileSize / this.maxBlockSize;
    } else {
      this.numberOfBlocks = _.parseInt(fileSize / this.maxBlockSize) + 1;
    }
    console.log('total blocks = ' + this.numberOfBlocks);
    const indexOfQueryStart = this.signedURL.indexOf('?');
    this.signedURL = this.signedURL.substring(0, indexOfQueryStart) + this.signedURL.substring(indexOfQueryStart);
    console.log(this.signedURL);
    this.uploadFileInBlocks();
  }

  uploadFileInBlocks() {

    if (this.totalBytesRemaining > 0) {
      console.log('current file pointer = ' + this.currentFilePointer + ' bytes read = ' + this.maxBlockSize);
      const fileContent = this.selectedFile.slice(this.currentFilePointer, this.currentFilePointer + this.maxBlockSize);
      const blockId = this.blockIdPrefix + this.pad(this.blockIds.length, 6);
      console.log('block id = ' + blockId);
      this.blockIds.push(btoa(blockId));
      this.commitBlock(fileContent);
      this.currentFilePointer += this.maxBlockSize;
      this.totalBytesRemaining -= this.maxBlockSize;
      console.log('totalBytesRemaining :: ', this.totalBytesRemaining);
      if (this.totalBytesRemaining < this.maxBlockSize) {
        this.maxBlockSize = this.totalBytesRemaining;
        console.log('this.maxBlockSize :: ', this.maxBlockSize);
      }
    } else {
      console.log('createBlocks::::');
      this.createBlocks().subscribe((data: any) => {
        this.fileReqBlocks = [];
        this.commitBlockList();
      }, (err) => {
        this.azurObserver.error(err);
      });
    }
  }

  createBlocks(): Observable<any> {
    return  forkJoin(
      this.fileReqBlocks.map(data => {
        return this.addBlock(data.uri, data.requestData).pipe(map(res => {
            this.bytesUploaded += data.requestData.length;
            // tslint:disable-next-line:max-line-length
            const percentComplete = ((parseFloat(_.toNumber(this.bytesUploaded)) / this.selectedFile.size) * 100).toFixed();
            console.log(percentComplete + ' %');
            const estimatedTime = this.doEstimateTimeCalculation();
            this.azurObserver.next({percentComplete: percentComplete, estimatedTime, bytesUploaded: this.bytesUploaded});
            return res;
        }));
      })
    );
  }

  doEstimateTimeCalculation() {
    const timeEnded: any = new Date();
    const timeElapsed: any = timeEnded - this.timeStarted; // Assuming that timeStarted is a Date Object
    const uploadSpeed = Math.floor(this.bytesUploaded / (timeElapsed / 1000)); // Upload speed in second
    let estimatedSecondsLeft: any = Math.round(((this.selectedFile.size - this.bytesUploaded) / uploadSpeed));
    if (!estimatedSecondsLeft) {
      return;
    }
    estimatedSecondsLeft  = this.humanizeDuration(estimatedSecondsLeft, 'seconds');
    return estimatedSecondsLeft;
  }

  humanizeDuration(duration, unit) {
    let minutes, seconds, hours, days;
    if (!_.isNumber(duration)) {
      throw new TypeError('Value must be a number.');
    }

    if (unit === 'sec' || unit === 'seconds') {
      seconds = duration;
    } else if (unit === 'ms' || unit === 'milliseconds' || !unit) {
      seconds = Math.floor(duration / 1000);
    } else {
      throw new TypeError('Unit must be seconds or milliseconds');
    }

    minutes = Math.floor(seconds / 60);
    seconds = seconds % 60;
    hours = Math.floor(minutes / 60);
    minutes = minutes % 60;
    days = Math.floor(hours / 24);
    hours = hours % 24;

    const parts = {days, hours, minutes, seconds};
    const remaining = Object.keys(parts)
      .map(part => {
        if (!parts[part]) { return; }
        return `${parts[part]} ${part}`;
      })
      .join(' ');
    return remaining;
  }

  commitBlock(fileContent) {
    this.reader.onloadend =  ((evt: any) => {
      if (evt.target.readyState === FileReader.DONE) {
        const uri = this.signedURL + '&comp=block&blockid=' + this.blockIds[this.blockIds.length - 1];
        const requestData = new Uint8Array(evt.target.result);
        this.fileReqBlocks.push({uri, requestData});
        this.uploadFileInBlocks();
      }
    });
    this.reader.readAsArrayBuffer(fileContent);
  }

  commitBlockList() {
    const uri = this.signedURL + '&comp=blocklist';
    console.log('commitBlockList :: ', uri);
    let requestBody = '<?xml version="1.0" encoding="utf-8"?><BlockList>';
    for (let i = 0; i < this.blockIds.length; i++) {
      requestBody += '<Latest>' + this.blockIds[i] + '</Latest>';
    }
    requestBody += '</BlockList>';
    console.log('commitBlockList ::' , requestBody);

    this.addBlockList(uri, requestBody).subscribe((event) => {
      this.azurObserver.complete();
    }, (error) => {
      this.azurObserver.error(error);
    });
  }

  addBlockList (uri: string, requestData: any): Observable<any> {
    const httpOptions = {
      headers: new HttpHeaders({
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-ms-blob-content-type': this.selectedFile.type
      })
    };
    return this.httpClient.put<any>(uri, requestData, httpOptions)
      .pipe(
        catchError(this.handleError)
      );
  }

  addBlock(uri: string, requestData: any): Observable<any> {

    return new Observable((observer) => {
      const fetchPromise = fetch(uri, {
        'headers': {
          'Content-Type': this.selectedFile.type,
          'x-ms-blob-type': 'BlockBlob'
        },
        'body': requestData,
        'method': 'PUT',
      });
      fetchPromise.then((value) => {
        observer.next();
        observer.complete();
      }, (err) => {
        console.log('addBlock::ERROR');
        observer.error(err);
        observer.complete();
      });
   });

    // const httpOptions = {
    //   headers: new HttpHeaders({
    //     'content-type': 'video/mp4',
    //     'x-ms-blob-type': 'BlockBlob'
    //   })
    // };
    // return this.httpClient.put<any>(uri, requestData, httpOptions)
    //   .pipe(
    //     catchError(this.handleError)
    //   );

  }

  private handleError(error: HttpErrorResponse) {
    if (error.error instanceof ErrorEvent) {
      // A client-side or network error occurred. Handle it accordingly.
      console.error('An error occurred:', error.error.message);
    } else {
      // The backend returned an unsuccessful response code.
      // The response body may contain clues as to what went wrong,
      console.error(
        `Backend returned code ${error.status}, ` +
        `body was: ${error.error}`);
    }
    // return an observable with a user-facing error message
    return throwError(
      'Something bad happened; please try again later.');
  }

   pad(number, length) {
    let str = '' + number;
    while (str.length < length) {
      str = '0' + str;
    }
    return str;
  }

}
