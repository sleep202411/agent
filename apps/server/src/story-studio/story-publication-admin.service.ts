import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AdminActor } from '../admin-auth';
import { CURRENT_CELL } from '../common/region/current-cell';
import { StoryPublicationJavaService } from './story-publication-java.service';
import {
  StoryStoreService,
  type StoryStoreListingDto,
} from './story-store.service';

export interface StoryPublicationReviewListingDto {
  contentVersion: string;
  listing: StoryStoreListingDto | null;
}

/** Admin reads the same immutable promotional material the player will see. */
@Injectable()
export class StoryPublicationAdminService {
  constructor(
    private readonly java: StoryPublicationJavaService,
    private readonly store: StoryStoreService,
  ) {}

  async listing(
    admin: AdminActor,
    gameId: string,
    contentVersion: string,
  ): Promise<StoryPublicationReviewListingDto> {
    const site = CURRENT_CELL === 'cn' ? 'cn' : 'global';
    if (admin.siteScope !== 'all' && admin.siteScope !== site) {
      throw new ForbiddenException({
        code: 'STORY_PUBLICATION_ADMIN_SITE_DENIED',
        message: 'This admin account cannot review works in this site.',
      });
    }
    const publication = await this.java.read(gameId);
    if (!publication) {
      throw new NotFoundException({
        code: 'STORY_PUBLICATION_NOT_FOUND',
        message: 'This interactive film has no publication to review.',
      });
    }
    const authorizedVersion =
      publication.status === 'draft' || publication.status === 'reviewing'
        ? publication.draftVersion
        : (publication.currentVersion ??
          (publication.status === 'offline' ? publication.draftVersion : null));
    if (!authorizedVersion || authorizedVersion !== contentVersion) {
      throw new ConflictException({
        code: 'STORY_PUBLICATION_REVIEW_VERSION_CHANGED',
        message:
          'The review version changed. Refresh the interactive film before reviewing its promotional materials.',
      });
    }
    return {
      contentVersion,
      listing: await this.store.getReviewListing(gameId, contentVersion),
    };
  }
}
