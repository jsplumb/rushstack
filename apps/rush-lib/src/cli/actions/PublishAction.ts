// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as colors from 'colors';
import { EOL } from 'os';
import * as path from 'path';
import {
  CommandLineFlagParameter,
  CommandLineStringParameter,
  CommandLineChoiceParameter
} from '@microsoft/ts-command-line';
import { FileSystem } from '@microsoft/node-core-library';

import {
  IChangeInfo,
  ChangeType
} from '../../api/ChangeManagement';
import { RushConfigurationProject } from '../../api/RushConfigurationProject';
import { Npm } from '../../utilities/Npm';
import { RushCommandLineParser } from '../RushCommandLineParser';
import { PublishUtilities } from '../../logic/PublishUtilities';
import { ChangelogGenerator } from '../../logic/ChangelogGenerator';
import { PrereleaseToken } from '../../logic/PrereleaseToken';
import { ChangeManager } from '../../logic/ChangeManager';
import { BaseRushAction } from './BaseRushAction';
import { PublishGit } from '../../logic/PublishGit';
import { VersionControl } from '../../utilities/VersionControl';
import { PolicyValidator } from '../../logic/policy/PolicyValidator';
import { VersionPolicy } from '../../api/VersionPolicy';
import { DEFAULT_PACKAGE_UPDATE_MESSAGE } from './VersionAction';

export class PublishAction extends BaseRushAction {
  private _addCommitDetails: CommandLineFlagParameter;
  private _apply: CommandLineFlagParameter;
  private _includeAll: CommandLineFlagParameter;
  private _npmAuthToken: CommandLineStringParameter;
  private _npmTag: CommandLineStringParameter;
  private _npmAccessLevel: CommandLineChoiceParameter;
  private _publish: CommandLineFlagParameter;
  private _regenerateChangelogs: CommandLineFlagParameter;
  private _registryUrl: CommandLineStringParameter;
  private _targetBranch: CommandLineStringParameter;
  private _prereleaseName: CommandLineStringParameter;
  private _partialPrerelease: CommandLineFlagParameter;
  private _suffix: CommandLineStringParameter;
  private _force: CommandLineFlagParameter;
  private _prereleaseToken: PrereleaseToken;
  private _versionPolicy: CommandLineStringParameter;
  private _applyGitTagsOnPack: CommandLineFlagParameter;

  private _releaseFolder: CommandLineStringParameter;
  private _pack: CommandLineFlagParameter;

  private _hotfixTagOverride: string;

  public constructor(parser: RushCommandLineParser) {
    super({
      actionName: 'publish',
      summary: 'Reads and processes package publishing change requests generated by "rush change".',
      documentation:
      'Reads and processes package publishing change requests generated by "rush change". This will perform a ' +
      'read-only operation by default, printing operations executed to the console. To commit ' +
      'changes and publish packages, you must use the --commit flag and/or the --publish flag.',
      parser
    });
  }

  protected onDefineParameters(): void {
    this._apply = this.defineFlagParameter({
      parameterLongName: '--apply',
      parameterShortName: '-a',
      description: 'If this flag is specified, the change requests will be applied to package.json files.'
    });
    this._targetBranch = this.defineStringParameter({
      parameterLongName: '--target-branch',
      parameterShortName: '-b',
      argumentName: 'BRANCH',
      description:
      'If this flag is specified, applied changes and deleted change requests will be' +
      'committed and merged into the target branch.'
    });
    this._publish = this.defineFlagParameter({
      parameterLongName: '--publish',
      parameterShortName: '-p',
      description: 'If this flag is specified, applied changes will be published to npm.'
    });
    this._addCommitDetails = this.defineFlagParameter({
      parameterLongName: '--add-commit-details',
      parameterShortName: undefined,
      description: 'Adds commit author and hash to the changelog.json files for each change.'
    });
    this._regenerateChangelogs = this.defineFlagParameter({
      parameterLongName: '--regenerate-changelogs',
      parameterShortName: undefined,
      description: 'Regenerates all changelog files based on the current JSON content.'
    });

    // NPM registry related parameters
    this._registryUrl = this.defineStringParameter({
      parameterLongName: '--registry',
      parameterShortName: '-r',
      argumentName: 'REGISTRY',
      description:
      `Publishes to a specified NPM registry. If this is specified, it will prevent the current commit will not be ` +
      'tagged.'
    });
    this._npmAuthToken = this.defineStringParameter({
      parameterLongName: '--npm-auth-token',
      parameterShortName: '-n',
      argumentName: 'TOKEN',
      description:
      'Provide the default scope NPM auth token to be passed into npm publish for global package publishing.'
    });
    this._npmTag = this.defineStringParameter({
      parameterLongName: '--tag',
      parameterShortName: '-t',
      argumentName: 'TAG',
      description:
      `The tag option to pass to npm publish. By default NPM will publish using the 'latest' tag, even if ` +
      `the package is older than the current latest, so in publishing workflows for older releases, providing ` +
      `a tag is important. When hotfix changes are made, this parameter defaults to 'hotfix'.`
    });
    this._npmAccessLevel = this.defineChoiceParameter({
      alternatives: ['public', 'restricted'],
      parameterLongName: '--set-access-level',
      parameterShortName: undefined,
      description:
      `By default, when Rush invokes "npm publish" it will publish scoped packages with an access level ` +
      `of "restricted". Scoped packages can be published with an access level of "public" by specifying ` +
      `that value for this flag with the initial publication. NPM always publishes unscoped packages with ` +
      `an access level of "public". For more information, see the NPM documentation for the "--access" ` +
      `option of "npm publish".`
    });

    // NPM pack tarball related parameters
    this._pack = this.defineFlagParameter({
      parameterLongName: '--pack',
      description:
        `Packs projects into tarballs instead of publishing to npm repository. It can only be used when ` +
        `--include-all is specified. If this flag is specified, NPM registry related parameters will be ignored.`
    });
    this._releaseFolder = this.defineStringParameter({
      parameterLongName: '--release-folder',
      argumentName: 'FOLDER',
      description:
      `This parameter is used with --pack parameter to provide customized location for the tarballs instead of ` +
      `the default value. `
    });
    // End of NPM pack tarball related parameters

    this._includeAll = this.defineFlagParameter({
      parameterLongName: '--include-all',
      parameterShortName: undefined,
      description: 'If this flag is specified, all packages with shouldPublish=true in rush.json ' +
      'or with a specified version policy ' +
      'will be published if their version is newer than published version.'
    });
    this._versionPolicy = this.defineStringParameter({
      parameterLongName: '--version-policy',
      argumentName: 'POLICY',
      description: 'Version policy name. Only projects with this version policy will be published if used ' +
      'with --include-all.'
    });
    this._prereleaseName = this.defineStringParameter({
      parameterLongName: '--prerelease-name',
      argumentName: 'NAME',
      description: 'Bump up to a prerelease version with the provided prerelease name. Cannot be used with --suffix'
    });
    this._partialPrerelease = this.defineFlagParameter({
      parameterLongName: '--partial-prerelease',
      parameterShortName: undefined,
      description: 'Used with --prerelease-name. Only bump packages to a prerelease version if they have changes.'
    });
    this._suffix = this.defineStringParameter({
      parameterLongName: '--suffix',
      argumentName: 'SUFFIX',
      description: 'Append a suffix to all changed versions. Cannot be used with --prerelease-name.'
    });
    this._force = this.defineFlagParameter({
      parameterLongName: '--force',
      parameterShortName: undefined,
      description: 'If this flag is specified with --publish, packages will be published with --force on npm'
    });
    this._applyGitTagsOnPack = this.defineFlagParameter({
      parameterLongName: '--apply-git-tags-on-pack',
      description: `If specified with --publish and --pack, git tags will be applied for packages` +
      ` as if a publish was being run without --pack.`
    });
  }

  /**
   * Executes the publish action, which will read change request files, apply changes to package.jsons,
   */
  protected run(): Promise<void> {
    return Promise.resolve().then(() => {
      PolicyValidator.validatePolicy(this.rushConfiguration, false);

      const allPackages: Map<string, RushConfigurationProject> = this.rushConfiguration.projectsByName;

      if (this._regenerateChangelogs.value) {
        console.log('Regenerating changelogs');
        ChangelogGenerator.regenerateChangelogs(allPackages, this.rushConfiguration);
        return Promise.resolve();
      }

      this._validate();

      if (this._includeAll.value) {
        this._publishAll(allPackages);
      } else {
        this._prereleaseToken = new PrereleaseToken(
          this._prereleaseName.value,
          this._suffix.value,
          this._partialPrerelease.value
        );
        this._publishChanges(allPackages);
      }

      console.log(EOL + colors.green('Rush publish finished successfully.'));
    });
  }

  /**
   * Validate some input parameters
   */
  private _validate(): void {
    if (this._pack.value && !this._includeAll.value) {
      throw new Error('--pack can only be used with --include-all');
    }
    if (this._releaseFolder.value && !this._pack.value) {
      throw new Error(`--release-folder can only be used with --pack`);
    }
    if (this._applyGitTagsOnPack.value && !this._pack.value) {
      throw new Error(`${this._applyGitTagsOnPack.longName} must be used `
      + `with ${this._pack.longName}`);
    }
  }

  private _publishChanges(allPackages: Map<string, RushConfigurationProject>): void {
    const changeManager: ChangeManager = new ChangeManager(this.rushConfiguration);
    changeManager.load(this.rushConfiguration.changesFolder,
      this._prereleaseToken,
      this._addCommitDetails.value);

    if (changeManager.hasChanges()) {
      const orderedChanges: IChangeInfo[] = changeManager.changes;
      const git: PublishGit = new PublishGit(this._targetBranch.value);
      const tempBranch: string = 'publish-' + new Date().getTime();

      // Make changes in temp branch.
      git.checkout(tempBranch, true);

      this._setDependenciesBeforePublish();

      // Make changes to package.json and change logs.
      changeManager.apply(this._apply.value);
      changeManager.updateChangelog(this._apply.value);

      this._setDependenciesBeforeCommit();

      if (VersionControl.hasUncommittedChanges()) {
        // Stage, commit, and push the changes to remote temp branch.
        git.addChanges(':/*');
        git.commit(this.rushConfiguration.gitVersionBumpCommitMessage || DEFAULT_PACKAGE_UPDATE_MESSAGE);
        git.push(tempBranch);

        this._setDependenciesBeforePublish();

        // Override tag parameter if there is a hotfix change.
        for (const change of orderedChanges) {
          if (change.changeType === ChangeType.hotfix) {
            this._hotfixTagOverride = 'hotfix';
            break;
          }
        }

        // npm publish the things that need publishing.
        for (const change of orderedChanges) {
          if (change.changeType && change.changeType > ChangeType.dependency) {
            const project: RushConfigurationProject | undefined = allPackages.get(change.packageName);
            if (project) {
              if (!this._packageExists(project)) {
                this._npmPublish(change.packageName, project.projectFolder);
              } else {
                console.log(`Skip ${change.packageName}. Package exists.`);
              }
            } else {
              console.log(`Skip ${change.packageName}. Failed to find its project.`);
            }
          }
        }

        this._setDependenciesBeforeCommit();

        // Create and push appropriate Git tags.
        this._gitAddTags(git, orderedChanges);
        git.push(tempBranch);

        // Now merge to target branch.
        git.checkout(this._targetBranch.value);
        git.pull();
        git.merge(tempBranch);
        git.push(this._targetBranch.value);
        git.deleteBranch(tempBranch);
      } else {
        git.checkout(this._targetBranch.value);
        git.deleteBranch(tempBranch, false);
      }
    }
  }

  private _publishAll(allPackages: Map<string, RushConfigurationProject>): void {
    console.log(`Rush publish starts with includeAll and version policy ${this._versionPolicy.value}`);

    let updated: boolean = false;
    const git: PublishGit = new PublishGit(this._targetBranch.value);

    allPackages.forEach((packageConfig, packageName) => {
      if (packageConfig.shouldPublish &&
        (!this._versionPolicy.value || this._versionPolicy.value === packageConfig.versionPolicyName)
      ) {
        const applyTag: (apply: boolean) => void = (apply: boolean): void => {
          if (!apply) {
            return;
          }

          // Do not tag packages that already exist. This will fail with a fatal error.
          if (this._packageExists(packageConfig)) {
            return;
          }

          git.addTag(!!this._publish.value && !this._registryUrl.value, packageName, packageConfig.packageJson.version);
          updated = true;
        };

        if (this._pack.value) {
          // packs to tarball instead of publishing to NPM repository
          this._npmPack(packageName, packageConfig);
          applyTag(this._applyGitTagsOnPack.value);
        } else if (this._force.value || !this._packageExists(packageConfig)) {
          // Publish to npm repository
          this._npmPublish(packageName, packageConfig.projectFolder);
          applyTag(true);
        } else {
          console.log(`Skip ${packageName}. Not updated.`);
        }
      }
    });
    if (updated) {
      git.push(this._targetBranch.value);
    }
  }

  private _gitAddTags(git: PublishGit, orderedChanges: IChangeInfo[]): void {
    for (const change of orderedChanges) {
      if (
        change.changeType &&
        change.changeType > ChangeType.dependency &&
        this.rushConfiguration.projectsByName.get(change.packageName)!.shouldPublish
      ) {
        git.addTag(!!this._publish.value && !this._registryUrl.value, change.packageName, change.newVersion!);
      }
    }
  }

  private _npmPublish(packageName: string, packagePath: string): void {
    const env: { [key: string]: string | undefined } = PublishUtilities.getEnvArgs();
    const args: string[] = ['publish'];

    if (this.rushConfiguration.projectsByName.get(packageName)!.shouldPublish) {
      this._addSharedNpmConfig(env, args);

      if (this._npmTag.value) {
        args.push(`--tag`, this._npmTag.value);
      } else if (this._hotfixTagOverride) {
        args.push(`--tag`, this._hotfixTagOverride);
      }

      if (this._force.value) {
        args.push(`--force`);
      }

      if (this._npmAccessLevel.value) {
        args.push(`--access`, this._npmAccessLevel.value);
      }

      // TODO: Yarn's "publish" command line is fairly different from NPM and PNPM.  The right thing to do here
      // would be to remap our options to the Yarn equivalents.  But until we get around to that, we'll simply invoke
      // whatever NPM binary happens to be installed in the global path.
      const packageManagerToolFilename: string = this.rushConfiguration.packageManager === 'yarn'
        ? 'npm' : this.rushConfiguration.packageManagerToolFilename;

      PublishUtilities.execCommand(
        !!this._publish.value,
        packageManagerToolFilename,
        args,
        packagePath,
        env);
    }
  }

  private _packageExists(packageConfig: RushConfigurationProject): boolean {
    const env: { [key: string]: string | undefined } = PublishUtilities.getEnvArgs();
    const args: string[] = [];
    this._addSharedNpmConfig(env, args);

    const publishedVersions: string[] = Npm.publishedVersions(packageConfig.packageName,
      packageConfig.projectFolder,
      env,
      args);
    return publishedVersions.indexOf(packageConfig.packageJson.version) >= 0;
  }

  private _npmPack(packageName: string, project: RushConfigurationProject): void {
    const args: string[] = ['pack'];
    const env: { [key: string]: string | undefined } = PublishUtilities.getEnvArgs();

    PublishUtilities.execCommand(
      !!this._publish.value,
      this.rushConfiguration.packageManagerToolFilename,
      args,
      project.projectFolder,
      env
    );

    if (this._publish.value) {
      // Copy the tarball the release folder
      const tarballName: string = this._calculateTarballName(project);
      const tarballPath: string = path.join(project.projectFolder, tarballName);
      const destFolder: string = this._releaseFolder.value ?
       this._releaseFolder.value : path.join(this.rushConfiguration.commonTempFolder, 'artifacts', 'packages');

      FileSystem.move({
        sourcePath: tarballPath,
        destinationPath: path.join(destFolder, tarballName),
        overwrite: true
      });
    }
  }

  private _calculateTarballName(project: RushConfigurationProject): string {
    // Same logic as how npm forms the tarball name
    const packageName: string = project.packageName;
    const name: string = packageName[0] === '@' ? packageName.substr(1).replace(/\//g, '-') : packageName;

    if (this.rushConfiguration.packageManager === 'yarn') {
      // yarn tarballs have a "v" before the version number
      return `${name}-v${project.packageJson.version}.tgz`;
    } else {
      return `${name}-${project.packageJson.version}.tgz`;
    }
  }

  private _setDependenciesBeforePublish(): void {
    for (const project of this.rushConfiguration.projects) {
      if (!this._versionPolicy.value || this._versionPolicy.value === project.versionPolicyName) {
        const versionPolicy: VersionPolicy | undefined = project.versionPolicy;

        if (versionPolicy) {
          versionPolicy.setDependenciesBeforePublish(project.packageName, this.rushConfiguration);
        }
      }
    }
  }

  private _setDependenciesBeforeCommit(): void {
    for (const project of this.rushConfiguration.projects) {
      if (!this._versionPolicy.value || this._versionPolicy.value === project.versionPolicyName) {
        const versionPolicy: VersionPolicy | undefined = project.versionPolicy;

        if (versionPolicy) {
          versionPolicy.setDependenciesBeforePublish(project.packageName, this.rushConfiguration);
        }
      }
    }
  }

  private _addSharedNpmConfig(env: { [key: string]: string | undefined }, args: string[]): void {
    let registry: string = '//registry.npmjs.org/';
    if (this._registryUrl.value) {
      const registryUrl: string = this._registryUrl.value;
      env['npm_config_registry'] = registryUrl; // eslint-disable-line dot-notation
      registry = registryUrl.substring(registryUrl.indexOf('//'));
    }

    if (this._npmAuthToken.value) {
      args.push(`--${registry}:_authToken=${this._npmAuthToken.value}`);
    }
  }
}
