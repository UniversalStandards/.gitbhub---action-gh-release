import * as core from '@actions/core'
import {paths, parseConfig, isTag, unmatchedPatterns, uploadUrl} from './util'
import {release, upload, GitHubReleaser} from './github'
import {getOctokit} from '@actions/github'

import {env} from 'process'

async function run(): Promise<void> {
  try {
    const config = parseConfig(env)
    if (!config.input_tag_name && !isTag(config.github_ref) && !config.input_draft) {
      throw new Error(`⚠️ GitHub Releases requires a tag`)
    }
    if (config.input_files && config.input_files?.length > 0) {
      const patterns = unmatchedPatterns(config.input_files)
      for (const pattern of patterns) {
        if (config.input_fail_on_unmatched_files) {
          throw new Error(`⚠️  Pattern '${pattern}' does not match any files.`)
        } else {
          core.warning(`🤔 Pattern '${pattern}' does not match any files.`)
        }
      }
      if (patterns.length > 0 && config.input_fail_on_unmatched_files) {
        throw new Error(`⚠️ There were unmatched files`)
      }
    }

    const gh = getOctokit(config.github_token, {
      throttle: {
        onRateLimit: (retryAfter, options) => {
          core.warning(`Request quota exhausted for request ${options.method} ${options.url}`)
          if (options.request.retryCount === 0) {
            // only retries once
            core.info(`Retrying after ${retryAfter} seconds!`)
            return true
          }
        },
        onAbuseLimit: (retryAfter, options) => {
          // does not retry, only logs a warning
          core.warning(`Abuse detected for request ${options.method} ${options.url}`)
        }
      }
    })
    //)
    const rel = await release(config, new GitHubReleaser(gh))
    if (config.input_files && config.input_files?.length > 0) {
      const files = paths(config.input_files)
      if (files.length === 0) {
        if (config.input_fail_on_unmatched_files) {
          throw new Error(`⚠️ ${config.input_files} not include valid file.`)
        } else {
          core.warning(`🤔 ${config.input_files} not include valid file.`)
        }
      }
      const currentAssets = rel.assets
      const assets = await Promise.all(
        files.map(async path => {
          const json = await upload(config, gh, uploadUrl(rel.upload_url), path, currentAssets)
          delete json.uploader
          return json
        })
      ).catch(error => {
        throw error
      })
      core.setOutput('assets', assets)
    }

    core.info(`🎉 Release ready at ${rel.html_url}`)
    core.setOutput('url', rel.html_url)
    core.setOutput('id', rel.id.toString())
    core.setOutput('upload_url', rel.upload_url)
  } catch (error) {
    core.setFailed(`Failed to create the new release: ${error}`)
  }
}

run()
