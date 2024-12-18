import { Request, Response } from "express";
import { subscriberSocialMedia } from "../dataModels/entities/subscriberSocialMedia.entity";
import { SubscriberFacebookSettings } from "../dataModels/entities/subscriberFacebook.entity";
import { getDataSource } from "../../utils/dataSource";
import { pageMetaDataTypes, VerificationData } from "../dataModels/types/meta.types";
import { CustomError, Success } from "../../utils/response";
import { BAD_REQUEST, checkSubscriberExitenceUsingId, CONFLICT, ERROR_COMMON_MESSAGE, FORBIDDEN, INTERNAL_ERROR, NOT_AUTHORIZED, NOT_FOUND, SUCCESS_GET } from "../../utils/common";
import { fetchFacebookPages, getMetaUserAccessTokenDb, installMetaApp, verifySignature } from "../../utils/socialMediaUtility";
import { socialMediaType } from "../dataModels/enums/socialMedia.enums";
import { handleLeadgenEvent, handleMessagingEvent } from "./webhook.services";
import { leadSource } from "../../leads/dataModels/enums/lead.enums";

export class metaServices {
    // Meta Webhook Verification Endpoint
    verifyWebhook = async (request: Request, response: Response) => {
        const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = request.query as VerificationData;
        if (mode === 'subscribe' && token === process.env.META_APP_VERIFY_TOKEN) {
            response.status(SUCCESS_GET).send(challenge);
            console.log('WEBHOOK:: Verified webhook');
            return;
        }
        response.status(FORBIDDEN).send('Forbidden');
    }

    // Meta Webhook Event Notification Endpoint
    handleWebhook = async (request: Request, response: Response) => {
        try {
            const signature = request.headers['x-hub-signature-256'] as string;
            const rawBody = (request as any).rawBody;
            const body = request.body;
            console.log("Body:",body);

            if (!signature || !signature.startsWith('sha256=')) {
                console.error('X-Hub-Signature-256 is not in request header');
                response.status(FORBIDDEN).send(CustomError(FORBIDDEN, 'X-Hub-Signature-256 is not in request header'));
                return;
            }
            
            const appSecret = process.env.META_APP_SECRET;
            if (!appSecret) {
                console.error('META_APP_SECRET is not defined');
                response.status(FORBIDDEN).send(CustomError(FORBIDDEN, 'META_APP_SECRET is not defined'));
                return;
            }
        
            // Validate Signature
            if (!verifySignature(signature, rawBody, appSecret)) {
                console.error('Invalid signature');
                response.status(FORBIDDEN).send(CustomError(FORBIDDEN, 'Invalid signature'));
                return;
            }
        
            console.info("Request header X-Hub-Signature validated");
            console.log("Event Received");
            // Acknowledge the webhook event
            response.status(SUCCESS_GET).send('EVENT_RECEIVED');
        
            // Process Page Events
            if(body.object === 'page') {
                const { entry } = body;
                for(const pageEntry of entry) {
                    let fields;
                    // Determine the event type
                    if (pageEntry?.changes?.[0]?.field === 'leadgen') {
                        fields = 'leadgen';
                    } else if (pageEntry?.messaging) {
                        fields = 'messages';
                    }

                    switch(fields) {
                        case "leadgen":
                            for (const change of pageEntry.changes || []) {
                                if (change.field === 'leadgen') {
                                    console.log("Leadgen Event Received");
                                    console.log(change);
                                    await handleLeadgenEvent(change);
                                }
                            }
                            break;
                        case "messages":
                            for(const message of pageEntry.messaging || []) {
                                console.log("Messaging Event Received");
                                console.log(message);
                                const source = leadSource.FACEBOOK;
                                await handleMessagingEvent(message, source);
                            }
                            break;
                        default:
                            console.warn(`Unhandled event field: ${fields}`);
                            break;
                    }

                }
            }

            // Process Instagram Events
            if(body.object === 'instagram') {
                const { entry } = body;
                for(const pageEntry of entry) {
                    let fields;
                    // Determine the event type
                    if (pageEntry?.changes?.[0]?.field === 'comments') {
                        fields = 'comments';
                    } else if (pageEntry?.messaging) {
                        fields = 'messages';
                    }

                    switch(fields) {
                        case "comments":
                            for (const change of pageEntry.changes || []) {
                                if (change.field === 'comments') {
                                    console.log("Comments Event Received");
                                    console.log(change);
                                }
                            }
                            break;
                        case "messages":
                            for(const message of pageEntry.messaging || []) {
                                console.log("Messaging Event Received");
                                console.log(message);
                            }
                            break;
                        default:
                            console.warn(`Unhandled event field: ${fields}`);
                            break;
                    }
                }
            }

            // Process Whatsapp Events
            if(body.object === 'whatsapp_business_account') {
                const { entry } = body;
                for(const pageEntry of entry) {
                    let fields;
                    // Determine the event type
                    if (pageEntry?.changes?.[0]?.field === 'messages') {
                        fields = 'messages';
                    }

                    switch(fields) {
                        case "messages":
                            for(const message of pageEntry.messaging || []) {
                                console.log("Messaging Event Received");
                                console.log(message);
                            }
                            break;
                        default:
                            console.warn(`Unhandled event field: ${fields}`);
                            break;
                    }
                }
            }
        } catch (error) {
            console.error('Error processing webhook event:', error);
        }
    };


    // Fetch facebook pages of the subscriber.
    fetchPages = async (request: Request, response: Response) => {
        try {
            const subscriberId: number = (request as any).user.userId;
            const userAceessToken: string | null = await getMetaUserAccessTokenDb(subscriberId);
            if(!userAceessToken) {
                console.error("User not authenticated to fetch facebook pages!");
                response.status(NOT_AUTHORIZED).send(CustomError(NOT_AUTHORIZED, "User not authenticated to fetch facebook pages!"));
                return;
            }
            const pageDetails = await fetchFacebookPages(userAceessToken);
            response.status(SUCCESS_GET).send(Success(pageDetails));
            return;
        } catch (error) {
            console.error("Error in fetching facebook pages", error);
            response.status(INTERNAL_ERROR).send(CustomError(INTERNAL_ERROR, ERROR_COMMON_MESSAGE));
            return;
        }
    }


    // Handler for choosing facebook pages
    choosePages = async (request: Request, response: Response) => {
        try {            
            const subscriberId: number = (request as any).user.userId;
            const {pages} = request.body as {pages: pageMetaDataTypes[]};
            
            if(pages.length === 0 ) {
                console.error("Page data not found");
                response.status(BAD_REQUEST).send(CustomError(BAD_REQUEST, "Page data not found!"));
                return;
            }

            const appDataSource = await getDataSource();
            const subscriberSocialMediaRepository = appDataSource.getRepository(subscriberSocialMedia);
            const subscriberFacebookRepository = appDataSource.getRepository(SubscriberFacebookSettings);
            const subscriberSocialMediaQueryBuilder = subscriberSocialMediaRepository.createQueryBuilder("subscriberSocialMedia");

            const existingSubscriber = await checkSubscriberExitenceUsingId(subscriberId);

            if(!existingSubscriber) {
                console.error("Subscriber not found");
                response.status(NOT_FOUND).send(CustomError(NOT_FOUND, "Subscriber not found!"));
                return;
            }
            const existingSubscriberSocialMediaData = await subscriberSocialMediaQueryBuilder
                .leftJoinAndSelect("subscriberSocialMedia.subscriber", "subscriber")
                .andWhere("subscriberSocialMedia.socialMedia = :socialMedia", { socialMedia: socialMediaType.FACEBOOK })
                .where("subscriber.subscriberId = :subscriberId", { subscriberId })
                .getOne();
            
            if(!existingSubscriberSocialMediaData) {
                console.error("Subscriber not authenticated to fetch facebook pages!");
                response.status(CONFLICT).send(CustomError(CONFLICT, "Subscriber not authenticated to fetch facebook pages!"));
                return;
            }

            for (const pageData of pages) {
                const pageExistance = await subscriberFacebookRepository.findOneBy({ pageId: pageData.id });
                if(!pageExistance) {
                    const subscriberFacebookEntity = new SubscriberFacebookSettings();
                    subscriberFacebookEntity.pageId = pageData.id;
                    subscriberFacebookEntity.pageAccessToken = pageData.access_token;
                    subscriberFacebookEntity.pageName = pageData.name;
                    subscriberFacebookEntity.pageTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
                    subscriberFacebookEntity.subscriberSocialMedia = existingSubscriberSocialMediaData;
                    subscriberFacebookEntity.subscriber = existingSubscriber;
                    await subscriberFacebookRepository.save(subscriberFacebookEntity);
                }
            }

            // Installing meta app on the subscriber's facebook pages
            await installMetaApp(subscriberId);

            console.info("Pages added successfully");
            response.status(SUCCESS_GET).send(Success("Pages added successfully!"));
            return;
        } catch (error) {
            console.error("Error in fetching facebook pages", error);
            response.status(INTERNAL_ERROR).send(CustomError(INTERNAL_ERROR, ERROR_COMMON_MESSAGE));
            return;
        }
    }
    
    // Handler for checking facebook status
    checkFacebookStatus = async (request: Request, response: Response) => {
       try {
        const subscriberId: number = (request as any).user.userId;

        const appDataSource = await getDataSource();
        const subscriberSocialMediaRepository = appDataSource.getRepository(subscriberSocialMedia);
        const subscriberSocialMediaQueryBuilder = subscriberSocialMediaRepository.createQueryBuilder("subscriberSocialMedia");
        const existingSubscriber = await checkSubscriberExitenceUsingId(subscriberId);

        if(!existingSubscriber) {
            console.error("Subscriber not found");
            response.status(CONFLICT).send(false);
            return;
        }

        const existingSubscriberSocialMediaData = await subscriberSocialMediaQueryBuilder
            .leftJoinAndSelect("subscriberSocialMedia.subscriber", "subscriber")
            .where("subscriber.subscriberId = :subscriberId", { subscriberId })
            .andWhere("subscriberSocialMedia.socialMedia = :socialMedia", { socialMedia: socialMediaType.FACEBOOK })
            .getOne();
        if(existingSubscriberSocialMediaData && existingSubscriberSocialMediaData.userAccessToken) {
            response.status(SUCCESS_GET).send(true);
            return;
        } else {
            response.status(SUCCESS_GET).send(false);
            return;
        }
       } catch (error) {
        console.error("Error while check if the user is connected with facebook.");
        throw error;
       }
    }
}