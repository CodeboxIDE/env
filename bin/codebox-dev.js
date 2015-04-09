#! /usr/bin/env node

var argv = require('minimist')(process.argv.slice(2));
var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var wrench = require('wrench');
var path = require('path');
var exec = require('child_process').exec;
var GitHubApi = require('github-api');
var Gittle = require('gittle');

var base = path.resolve(argv._[0] || "./Codebox");
var codeboxBase = path.resolve(base, "codebox");
var codeboxOrg = "CodeboxIDE";
var packagePrefix = "package-";

function cloneRepo(pkg) {
    return Q()
    .then(function() {
        var output = path.resolve(base, pkg.name);

        if (fs.existsSync(output)) {
            console.log(" -> "+pkg.name+"' is already installed")
        } else {
            console.log(" -> Clone '"+pkg.name+"'");
            return Gittle.clone(pkg.clone_url, output);
        }
    });
}

Q()
.then(function() {
    console.log("Initialize Codebox Development Environment in", base);
    console.log(" -> Listing GitHub repositories");
    var github = new GitHubApi({});
    var user = github.getUser();
    return Q.nfcall(user.orgRepos.bind(user), codeboxOrg);
})
.then(function(repos) {
    var packages = _.filter(repos, function(repo) {
        return repo.name.indexOf(packagePrefix) === 0;
    });
    var codeboxCore = _.find(repos, { name: "codebox" });

    return cloneRepo(codeboxCore)
    .thenResolve(packages);
})
.then(function(packages) {
    console.log(" ->", packages.length, "packages found");
    return _.reduce(packages, function(prev, pkg) {
        return prev.then(function() {
            return cloneRepo(pkg);
        })
    }, Q());
})
.then(function() {
    var filenames = fs.readdirSync(base);

    _.each(filenames, function(filename) {
        if (filename.indexOf(packagePrefix) !== 0) return;

        var from = path.resolve(base, filename);
        var to = path.resolve(codeboxBase, "packages", filename.slice(packagePrefix.length));

        console.log(' -> Link', filename, 'to', path.relative(base, to));

        var stat = null;

        try { stat = fs.lstatSync(to); } catch (e) {};

        if (stat && stat.isSymbolicLink()) {
            fs.unlinkSync(to);
        } else if (fs.existsSync(to)) {
            wrench.rmdirSyncRecursive(to);
        }

        fs.symlinkSync(from, to, 'dir');
    });
})
.then(function() {
    console.log("-> Install node dependencies for codebox");
    return Q.nfcall(exec, "npm install .", { cwd: codeboxBase });
})
.then(function() {
    console.log("");
    console.log("You're ready to go! Run codebox using:")
    console.log("    $ cd "+path.relative(process.cwd(), codeboxBase)+" && bin/codebox.js");
})
.fail(function(err) {
    console.log("Error:", err);
    process.exit(1);
});
