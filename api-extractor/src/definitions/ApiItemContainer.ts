import ApiItem, { IApiItemOptions } from './ApiItem';

/**
  * This is an abstract base class for ApiPackage, ApiEnum, and ApiStructuredType,
  * which all act as containers for other ApiItem definitions.
  */
abstract class ApiItemContainer extends ApiItem {
  public memberItems: Map<string, ApiItem> = new Map<string, ApiItem>();

  constructor(options: IApiItemOptions) {
    super(options);
  }

  /**
   * Return a list of the child items for this container, sorted alphabetically.
   */
  public getSortedMemberItems(): ApiItem[] {
    const apiItems: ApiItem[] = [];
    this.memberItems.forEach((apiItem: ApiItem) => {
      apiItems.push(apiItem);
    });

    return apiItems
      .sort((a: ApiItem, b: ApiItem) => a.name.localeCompare(b.name));
  }

  /**
   * Add a child item to the container.
   */
  protected addMemberItem(apiItem: ApiItem): void {
    if (apiItem.hasAnyIncompleteTypes()) {
      this.reportWarning(`${apiItem.name} has incomplete type information`);
    } else {
      this.innerItems.push(apiItem);
      this.memberItems.set(apiItem.name, apiItem);
    }
  }
}

export default ApiItemContainer;
