/// <reference path="../typings/tsd.d.ts" />

import {ExtensionContext, commands, window, Range, QuickPickItem, QuickPickOptions} from 'vscode';
import * as http from 'http';
import * as Q from 'q';

const exec = require('child_process').exec;
const nodeModules = require('./node-native-modules');
const moduleRegEx = /require\(("|')[^.].*?("|')\)|import.*?('|")[^.].*?('|")/g;

export function activate(context: ExtensionContext) {
  let disposable = commands.registerCommand('extension.openPackageSource', () => {
    const editor = window.activeTextEditor;
    const selection = editor.selection;
    
    let selectedText: string;
    let packagesFound: string[];
    
    if (selection.isEmpty) {
      selectedText = editor.document.getText(new Range(selection.start.line, 0, selection.end.line+1, 0))
    } else {
      selectedText = editor.document.getText(selection);
    }
    
    packagesFound = selectedText.match(moduleRegEx);
    
    if (!packagesFound) {
      selectedText = editor.document.getText(new Range(selection.start.line, 0, selection.end.line+1, 0));
      packagesFound = selectedText.match(moduleRegEx);
    }
    
    if (!packagesFound || packagesFound.length === 0) {
      packagesFound = editor.document.getText().match(moduleRegEx);
    }
    
    if (packagesFound.length === 1) {
      getPackageSourceUrl(getCleanPackageName(packagesFound[0]))
        .then(openUrl)
        .catch(handleError);
    } else if (packagesFound.length > 1) {
      for (let i = 0; i < packagesFound.length; i++) {
        packagesFound[i] = getCleanPackageName(packagesFound[i]);
      }
      
      showPackageOptions(packagesFound)
        .then(getPackageSourceUrl)
        .then(openUrl)
        .catch(handleError);
    }
  });
  
  function getPackageSourceUrl(packageName: string): Q.Promise<string> {
    let deferred: Q.Deferred<string> = Q.defer<string>();
    
    if (!packageName) {
      deferred.reject('No selection');
      return;
    }
    
    if (nodeModules.NativeModules.indexOf(packageName) !== -1) {
      deferred.resolve(nodeModules.getApiUrl(packageName));
    }
    
    let packageTry = packageName;
    
    do{
    
      http.get('http://registry.npmjs.org/' + packageTry, (response: http.ClientResponse) => {
        let body: string = '';
        
        response.on('data', (d) => {
          body += d;
        });
        
        response.on('end', () => {
          const responseJson = JSON.parse(body);
          
          if (responseJson.repository && responseJson.repository.url) {
            let url = responseJson.repository.url;
            url = url.replace(/^git/, 'http');
            if (url.indexOf('http') === -1 ) {
              deferred.reject('Invalid project url');
              return;
            }
            
            url = url.substr(url.indexOf('http'));
            deferred.resolve(url);
          }
        });
      }).on('error', (err) => {
        deferred.reject(err.message);
      });
      
      if (!packageTry) deferred.reject('No repository found!');

      let sliceTo = Math.max( packageTry.lastIndexOf('/'), 0 );
      packageTry = packageTry.slice(0, sliceTo);
    
    } while (packageTry);
        
    return deferred.promise;
  }
  
  function openUrl(url: string): void {
    let openCommand: string;
    
    switch (process.platform) {
      case 'darwin':
        openCommand = 'open ';
        break;
      case 'win32':
        openCommand = 'start ';
        break;
      default:
        return;
    }
    
    exec(openCommand + url);
  }
  
  function showPackageOptions(packages: string[]): Q.Promise<string> {
    let opts: QuickPickOptions = { matchOnDescription: true, placeHolder: "We found multiple packages. Which one do you want to open?" };
    let items: QuickPickItem[] = [];
    let deferred: Q.Deferred<string> = Q.defer<string>();
    
    for (let i = 0; i < packages.length; i++) {
      items.push({ label: packages[i], description: 'Open ' + packages[i] + ' repository'});
    }
    
    window.showQuickPick(items, opts).then((selection) => {
      if (selection) {
        deferred.resolve(selection.label);  
      }
    });
    
    return deferred.promise;
  }
  
  function handleError(errorMessage: string): void {
    window.showErrorMessage(errorMessage);
  }
  
  function getCleanPackageName(requireStatement: string): string {
    return requireStatement.replace(/^require(\(|\s)("|')/, '').replace(/^import.*?('|")/, '').replace(/("|')\)?$/, '').replace(/('|")$/, '');
  }
	
	context.subscriptions.push(disposable);
}
