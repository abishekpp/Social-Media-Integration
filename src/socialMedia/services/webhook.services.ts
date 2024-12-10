import { LeadsService } from "../../leads/services/lead.service";
import { getDataSource } from "../../utils/dataSource";
import { fetchingLeadDetails, fetchMessageDetails, parseLeadData } from "../../utils/socialMediaUtility";
import { SubscriberFacebookSettings } from "../dataModels/entities/subscriberFacebook.entity";
import { LeadData } from "../dataModels/types/meta.types";

export const handleLeadgenEvent = async (event: any) => {
  try {
    const leadgenId = event.value.leadgen_id;
    const pageId = event.value.page_id;
  
    if (leadgenId && pageId) {
      const appDataSource = await getDataSource();
      const subscriberFacebookRepository = appDataSource.getRepository(SubscriberFacebookSettings);
      const subscriberFacebookQueryBuilder = subscriberFacebookRepository.createQueryBuilder("subscriberFacebook");
      const subscriberFacebookData = await subscriberFacebookQueryBuilder
          .leftJoinAndSelect("subscriberFacebook.subscriberSocialMedia", "subscriberSocialMedia")
          .leftJoinAndSelect("subscriberSocialMedia.subscriber", "subscriber")
          .where("subscriberFacebook.pageId = :pageId", { pageId })
          .getOne();
      if(!subscriberFacebookData) {
        console.log(`No social media data found for the page with ID ${pageId}`);
        return;
      }
      const subscriberId = subscriberFacebookData.subscriberSocialMedia.subscriber.subscriberId;
      const pageAccessToken = subscriberFacebookData.pageAccessToken;

      const leadData: LeadData = await fetchingLeadDetails(pageAccessToken, leadgenId);
      if (!leadData) {
        console.log(`No lead data found for the leadgen with ID ${leadgenId}`);
        return;
      }

      const parsedLead = parseLeadData(leadData, subscriberId);
      if (parsedLead) {
          const leadsService = new LeadsService();
          await leadsService.createSubscribersLeads(parsedLead);
      }
    }
  } catch (error) {
    console.error("Error while handling leadgen event");
    throw error;
  }
}

export const handleMessagingEvent = async (event: any) => {
  try {
    const messageId = event.message.mid;
    const senderId = event.sender.id;
    const pageId = event.recipient.id;
    console.log('New Message:', messageId, senderId, pageId);

    if(!pageId) {
      console.error('RecipientId or PageId is missing!');
      return;
    }

    if(!messageId) {
      console.error("Message id is missing!")
      return;
    }

    const pageAccessToken =  "EAAHdP3GumlsBOxIOpPgzLO1bUrRCBZCA7eU28uFY1U8XmrgmAZAWbff5ePqPGopPpq2wLRo1ZC96ZBvDvDJIypsukklSHq2pC5ZCFk3ZAavP8NtmmVdY705bPBw1iefhAYdn5MS7lA1ZAMxC6tBbqKiPqZA4Db7AKzW2JZCeuXw6yMAHZA6ILhnSgcWyVIzMKTb2QbQKb62cw3AE3oxmjyrfsGhom4MriH82y3uynQHQHxBAZDZD"
    if(!pageAccessToken) {
      console.error("Page access tokekn is missing for the page id!");
      return;
    }

    const msgDetails = await fetchMessageDetails(messageId, pageAccessToken)
    if(!msgDetails) {
      console.error("Sender does'nt exist!");
      return;
    }
    console.log(msgDetails);

  } catch (error) {
    console.error("Error while handling messaging event");
    throw error;
  }
};
  