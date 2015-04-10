#! /usr/bin/env node

var argv = require('minimist')(process.argv.slice(2));
var _ = require('lodash');
var colors = require('colors/safe');
var Q = require('q');
var fs = require('fs');
var wrench = require('wrench');
var path = require('path');
var exec = require('child_process').exec;
var GitHubApi = require('github-api');
var Gittle = require('gittle');

// Base folder for all codebox repos
var base = path.resolve(argv._[0] || "./Codebox");

// Folder for codebox core
var codeboxBase = path.resolve(base, "codebox");

// Codebox org name on github
var codeboxOrg = "CodeboxIDE";

// Prefix for packages
var packagePrefix = "package-";

// Pull updates from github
var optsFetch = argv.fetch != undefined;


function cloneRepo(pkg, opts) {
    var needClean = false;
    var output = path.resolve(base, pkg.name);

    opts = _.defaults(opts || {}, {
        clean: ["node_modules", "pkg-build.js"]
    });

    return Q()
    .then(function() {
        if (fs.existsSync(output)) {
            console.log("  -> "+pkg.name+"' is already installed");

            if (!optsFetch) return;

            var repo = Gittle(output);
            return repo.status()
            .then(function(status) {
                if (_.size(status.files) == 0) {
                    console.log("    -> Fetch updates");
                    needClean = true;
                    return repo.fetch(pkg.clone_url);
                } else {
                    console.log("    -> "+_.size(status.files)+" files edited locally (ignore fetch)");
                }
            });
        } else {
            console.log("  -> Clone '"+pkg.name+"'");
            return Gittle.clone(pkg.clone_url, output);
        }
    })
    .then(function() {
        if (!needClean) return;
        console.log("    -> Cleaning repository");
        return runCommand("rm -rf "+opts.clean.join(" "), {
            cwd: output
        });
    });
}

function runCommand(cmd, opts) {
    var d = Q.defer();

    var child = exec(cmd, opts, function (error, stdout, stderr) {
        if (error) return d.reject(error);
        d.resolve({
            stdout: stdout,
            stderr: stderr
        });
    });

    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

    return d.promise;
}

Q()
.then(function() {
    console.log("Initialize Codebox Development Environment in", base);
})
.then(function() {
    console.log("");
    console.log(colors.magenta("Listing GitHub repositories"));

    var github = new GitHubApi({});
    var user = github.getUser();
    return Q.nfcall(user.orgRepos.bind(user), codeboxOrg);
})
.then(function(repos) {
    var packages = _.filter(repos, function(repo) {
        return repo.name.indexOf(packagePrefix) === 0;
    });
    console.log(colors.cyan(packages.length+" packages found"));

    var codeboxCore = _.find(repos, { name: "codebox" });
    return cloneRepo(codeboxCore)
    .thenResolve(packages);
})
.then(function(packages) {
    return _.reduce(packages, function(prev, pkg) {
        return prev.then(function() {
            return cloneRepo(pkg);
        })
    }, Q());
})
.then(function() {
    console.log("");
    console.log(colors.magenta("Linking packages into Codebox"));
    var filenames = fs.readdirSync(base);

    _.each(filenames, function(filename) {
        if (filename.indexOf(packagePrefix) !== 0) return;

        var from = path.resolve(base, filename);
        var to = path.resolve(codeboxBase, "packages", filename.slice(packagePrefix.length));

        console.log('  -> Link', filename, 'to', path.relative(base, to));

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
    console.log("");
    console.log(colors.magenta("Install node dependencies for codebox"));
    return runCommand("npm install .", { cwd: codeboxBase });
})
.then(function() {
    console.log("");
    console.log(colors.magenta("Build codebox"));
    return runCommand("./node_modules/.bin/gulp", { cwd: codeboxBase });
})
.then(function() {
    console.log("");
    console.log(colors.green("Everything is perfect!"));
    console.log("");
    console.log("Run Codebox using:")
    console.log("    $ cd "+path.relative(process.cwd(), codeboxBase)+" && bin/codebox.js");
    console.log("Update everything using:")
    console.log("    $ codebox-dev --fetch");
    console.log("");
})
.fail(function(err) {
    console.log(colors.red("Error: "+err.message));
    console.log(err.stack || "");
    process.exit(1);
});
