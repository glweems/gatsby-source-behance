/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable no-console */
/* eslint-disable import/prefer-default-export */
import * as crypto from 'crypto';
import * as axios from 'axios';
import * as slugify from 'slugify';
import { Promise } from 'bluebird';
import * as fs from 'fs';
import * as request from 'request';
import * as progress from 'request-progress';

const sluggy = (string: string): string => slugify(string.toLowerCase())


const dict = arr =>
    Object.assign(...arr.map(([k, v]) => ({ [`size_${k}`]: v })))

// Transform the sizes and dimensions properties (these have numeral keys returned by the Behance API)
const transformImage = imageObject => ({
    ...imageObject,
    sizes: dict(Object.entries(imageObject.sizes)),
    dimensions: dict(Object.entries(imageObject.dimensions)),
})

// Transform the properties that have numbers as keys
const transformProject = project => ({
    ...project,
    covers: dict(Object.entries(project.covers)),
    owners: project.owners.map(owner => ({
        ...owner,
        images: dict(Object.entries(owner.images)),
    })),
    modules: project.modules.map(module => {
        if (module.type === `image`) return transformImage(module)
        if (module.type === `media_collection`)
            return { ...module, components: module.components.map(transformImage) }
        return module
    }),
})

interface Options {
    username: string;
    apiKey: string;
    folder: fs.PathLike;
}

export const sourceNodes = async (
    { actions: { createNode }, reporter }: any,
    { username, apiKey, folder = './behance' }: Options) => {

    // Throw error if no username / apiKey
    if (!username || !apiKey) {
        throw new Error('You need to define username and apiKey');
    }

    // const activity = reporter.activityTimer(`Getting Data From Behance`)

    // activity.start()

    const shouldIWrite = (path: fs.PathLike): void => {
        if (!fs.existsSync(path)) {
            fs.mkdirSync(path);
            reporter.log(path, `Created Directory`);
        } else {
            reporter.info(path, `Already created`);
        }
    };

    // Should I create base dir
    shouldIWrite(folder);

    const axiosClient = axios.create({
        baseURL: 'https://www.behance.net/v2/',
    });

    const rateLimit = 500;
    let lastCalled: number;

    const rateLimiter = (call: unknown) => {
        const now = Date.now();
        if (lastCalled) {
            lastCalled += rateLimit;
            const wait = lastCalled - now;
            if (wait > 0) {
                return new Promise(resolve => setTimeout(() => resolve(call), wait));
            }
        }
        lastCalled = now;
        return call;
    };

    axiosClient.interceptors.request.use(rateLimiter);


    const {
        data: { projects },
    } = await axiosClient.get(`/users/${username}/projects?api_key=${apiKey}`);


    const {
        data: { user },
    } = await axiosClient.get(`/users/${username}?api_key=${apiKey}`);

    const jsonStringUser = JSON.stringify(user);

    // Request detailed information about each project
    const requests = projects.map((project: { id: string }) =>
        axiosClient.get(`/projects/${project.id}?api_key=${apiKey}`));



    const projectsDetailed = await Promise.all(requests).map(({ data: { project } }: any) => project);

    // Create node for each project
    projectsDetailed.map(async (originalProject: any) => {
        const project = transformProject(originalProject);
        const jsonString = JSON.stringify(project);
        const slug: string = sluggy(project.name);
        const dest: fs.PathLike = `${slug}-cover.jpg`;

        const download = (url: string, file: fs.PathLike) => progress(request(url), {
        })
            .on('progress', (state: { time: { elapsed: any } }) => {
                // reporter.info(dest, state.time.elapsed);
            })
            .on('error', (err: Error) => {
                // reporter.error(err.message);
            })
            .on('end', () => {
                // reporter.info(`Downloaded: ${file}`);
            })
            .pipe(fs.createWriteStream(`${folder}/${file}`));




        if (!fs.existsSync(dest)) {
            download(project.covers.size_original, dest);
            // activity.setStatus(dest, 'Downloaded');
        } else {
            // activity.setStatus(dest, 'Already downloaded');
        }

        // activity.setStatus(dest, 'Covers Downloaded');




        project.modules.map(({ sizes }, i) => {
            // activity.setStatus('Downloading Project Images');
            const fileName = `${folder}/${slug}-${i}.jpg`
            if (!sizes || sizes === null || sizes === undefined) {
                return
            }
            const { size_original } = sizes

            if (!fs.existsSync(fileName)) {
                download(size_original, `${slug}-${i}.jpg`);
                // activity.setStatus(fileName, 'Downloaded');
            } else {
                // activity.setStatus(fileName, 'Already Downloaded');
            }
        })


        // activity.end()


        const projectListNode = {
            projectID: project.id,
            slug,
            cover: dest,
            name: project.name,
            published: project.published_on,
            created: project.created_on,
            modified: project.modified_on,
            url: project.url,
            privacy: project.privacy,
            areas: project.fields,
            covers: project.covers,
            matureContent: project.mature_content,
            matureAccess: project.mature_access,
            owners: project.owners,
            stats: project.stats,
            conceived: project.conceived_on,
            canvasWidth: project.canvas_width,
            tags: project.tags,
            description: project.description,
            editorVersion: project.editor_version,
            allowComments: project.allow_comments,
            modules: project.modules,
            shortURL: project.short_url,
            copyright: project.copyright,
            tools: project.tools,
            styles: project.styles,
            creatorID: project.creator_id,
            children: [],
            id: project.id.toString(),
            parent: '__SOURCE__',
            internal: {
                type: 'BehanceProjects',
                contentDigest: crypto
                    .createHash('md5')
                    .update(jsonString)
                    .digest('hex'),
            },
        };
        createNode(projectListNode);
    });


    const userNode = {
        userID: user.id,
        names: {
            firstName: user.first_name,
            lastName: user.last_name,
            username: user.username,
            displayName: user.display_name,
        },
        url: user.url,
        website: user.website,
        avatar: user.images['276'],
        company: user.company,
        place: {
            city: user.city,
            state: user.state,
            country: user.country,
            location: user.location,
        },
        areas: user.fields,
        stats: user.stats,
        links: user.links,
        sections: user.sections,
        socialMedia: user.social_links,
        children: [],
        id: user.id.toString(),
        parent: '__SOURCE__',
        internal: {
            type: 'BehanceUser',
            contentDigest: crypto
                .createHash('md5')
                .update(jsonStringUser)
                .digest('hex'),
        },
    };
    createNode(userNode);


    /* collections.map(async originalAppreciation => {
const appreciation = transformAppreciation(originalAppreciation)
const jsonString = JSON.stringify(appreciation)

const appreciationNode = {
projectID: appreciation.id,
name: appreciation.title,
projectCount: appreciation.project_count,
followerCount: appreciation.followerCount,
data: appreciation.data,
public: appreciation.public,
created: appreciation.created_on,
updated: appreciation.updated_on,
modified: appreciation.modified_on,
url: appreciation.url,
covers: appreciation.covers,
projects: appreciation.projects,
matureContent: appreciation.mature_content,
matureAccess: appreciation.mature_access,
owners: appreciation.owners,
isOwner: appreciation.is_owner,
isCoOwner: appreciation.is_coowner,
multipleOwners: appreciation.multiple_owners,
galleryText: appreciation.gallery_text,
stats: appreciation.stats,
conceived: appreciation.conceived_on,
creatorID: appreciation.creator_id,
userID: appreciation.user_id,
children: [],
id: appreciation.id.toString(),
parent: `__SOURCE__`,
internal: {
type: `BehanceAppreciations`,
contentDigest: crypto
.createHash(`md5`)
.update(jsonString)
.digest(`hex`),
},
}
createNode(appreciationNode)
}) */
};
