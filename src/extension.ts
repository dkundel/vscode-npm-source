/// <reference path="../typings/tsd.d.ts" />

import { ExtensionContext, commands, window, Range, QuickPickItem, QuickPickOptions, workspace } from 'vscode';
import * as http from 'http';
import * as Q from 'q';
import * as path from 'path';
import * as fs from 'fs';

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

    if (editor.document && editor.document.languageId === 'json') {
      packagesFound = readFromPackageJson(editor, selectedText);
    } else {
      packagesFound = selectedText.match(moduleRegEx);
    }

    if (!packagesFound) {
      selectedText = editor.document.getText(new Range(selection.start.line, 0, selection.end.line+1, 0));
      packagesFound = selectedText.match(moduleRegEx);
    }
    
    if (!packagesFound || packagesFound.length === 0) {
      if (editor.document && editor.document.languageId === 'json') {
        packagesFound = readFromPackageJson(editor, editor.document.getText());
      } else {
        packagesFound = editor.document.getText().match(moduleRegEx);
      }
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

    let gitUrl = getGitUrlFromPackageJson(packageName); 
    if (gitUrl) {
      deferred.resolve(gitUrl);
    }

    let packageTry = packageName;

    const determineUrlRecursively = () => {
      return getUrlFromNpm(packageTry).then(url => {
        if (!url) {
          let sliceTo = Math.max(packageTry.lastIndexOf('/'), 0);
          packageTry = packageTry.slice(0, sliceTo);

          if (packageTry) {
            return determineUrlRecursively();
          } else {
            return null;
          }
        } else {
          return url;
        }
      })
    };

    determineUrlRecursively().then(url => {
      deferred.resolve(url);
    }).catch(err => {
      deferred.reject(err);
    });

    return deferred.promise;
  }

  function getUrlFromNpm(packageName: string): Q.Promise<string> {
    let deferred: Q.Deferred<string> = Q.defer<string>();

    http.get('http://registry.npmjs.org/' + packageName, (response: http.ClientResponse) => {
      let body: string = '';
      
      response.on('data', (d) => {
        body += d;
      });
      
      response.on('end', () => {
        const responseJson = JSON.parse(body);
        
        if (responseJson.repository && responseJson.repository.url) {
          let url = responseJson.repository.url;
          url = getBrowsablePackageUrl(url);
          if (url.indexOf('http') === -1 ) {
            deferred.resolve(null);
            return;
          }
          
          url = url.substr(url.indexOf('http'));
          deferred.resolve(url);
        } else {
          deferred.resolve(null);
        }
      });
    }).on('error', (err) => {
      deferred.reject(err.message);
    });

    return deferred.promise;
  }

  function getGitUrlFromPackageJson(packageName: string): string {
    let fileName = path.join(workspace.rootPath, 'package.json');
		let contents = fs.readFileSync(fileName).toString();
		let json = JSON.parse(contents);

    let result = null;

    if (json && json.dependencies && json.dependencies[packageName]) {
      let packageUrl = json.dependencies[packageName];
      if (packageUrl.indexOf('git') >= 0) {
        result = getBrowsablePackageUrl(packageUrl);
      }
    }
    return result;
  }

  function getBrowsablePackageUrl(url: string): string {
    const regex1 = /^git\+?/g;
    url = url.replace(regex1, '');
    const regex2 = /(^:\/\/|^ssh:\/\/)/g;
    url = url.replace(regex2, 'https://');
    const regex3 = /:\/\/.*@/g;
    url = url.replace(regex3, '://');
    const regex4 = /:([^\/])/g;
    url = url.replace(regex4, '/$1');
    const regex5 = /\.git#/g;
    url = url.replace(regex5, '/tree/');
    return url;
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

  function readFromPackageJson(editor: TextEditor, selectedText: string) {
    let content = JSON.parse(editor.document.getText());
    let potentialPackages = [];
    if (content.dependencies) {
      potentialPackages = potentialPackages.concat(Object.keys(content.dependencies));
    }
    if (content.devDependencies) {
      potentialPackages = potentialPackages.concat(Object.keys(content.devDependencies));
    }
    if (content.peerDependencies) {
      potentialPackages = potentialPackages.concat(Object.keys(content.peerDependencies));
    }
    return potentialPackages.filter(function (pkg) { return selectedText.indexOf(pkg) !== -1 });
  }
  
  function handleError(errorMessage: string): void {
    window.showErrorMessage(errorMessage);
  }
  
  function getCleanPackageName(requireStatement: string): string {
    return requireStatement.replace(/^require(\(|\s)("|')/, '').replace(/^import.*?('|")/, '').replace(/("|')\)?$/, '').replace(/('|")$/, '');
  }

  context.subscriptions.push(disposable);
}
