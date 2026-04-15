/* ===== GraphQL シミュレーター プリセット ===== */

import type {
  GQLSchema,
  GQLTypeDef,
  ResolverMap,
  GQLPreset,
} from './types';
import {
  runGraphQL,
  objectType,
  field,
  named,
  nonNull,
  list,
} from './engine';

/* ================================================================
   共通スキーマ / データ
   ================================================================ */

/** ブログアプリのスキーマを構築 */
function blogSchema(): GQLSchema {
  const types = new Map<string, GQLTypeDef>();

  types.set('Query', objectType('Query', [
    field('user', named('User'), [{ name: 'id', type: nonNull(named('Int')) }]),
    field('users', list(named('User'))),
    field('post', named('Post'), [{ name: 'id', type: nonNull(named('Int')) }]),
    field('posts', list(named('Post')), [{ name: 'limit', type: named('Int') }]),
    field('search', list(named('SearchResult')), [{ name: 'query', type: nonNull(named('String')) }]),
  ]));

  types.set('Mutation', objectType('Mutation', [
    field('createPost', named('Post'), [
      { name: 'title', type: nonNull(named('String')) },
      { name: 'body', type: nonNull(named('String')) },
      { name: 'authorId', type: nonNull(named('Int')) },
    ]),
    field('updateUser', named('User'), [
      { name: 'id', type: nonNull(named('Int')) },
      { name: 'name', type: named('String') },
      { name: 'email', type: named('String') },
    ]),
  ]));

  types.set('User', objectType('User', [
    field('id', nonNull(named('Int'))),
    field('name', nonNull(named('String'))),
    field('email', nonNull(named('String'))),
    field('posts', list(named('Post'))),
    field('role', named('Role')),
  ]));

  types.set('Post', objectType('Post', [
    field('id', nonNull(named('Int'))),
    field('title', nonNull(named('String'))),
    field('body', named('String')),
    field('author', named('User')),
    field('comments', list(named('Comment'))),
    field('tags', list(named('String'))),
  ]));

  types.set('Comment', objectType('Comment', [
    field('id', nonNull(named('Int'))),
    field('text', nonNull(named('String'))),
    field('author', named('User')),
  ]));

  /* Union: SearchResult = User | Post */
  types.set('SearchResult', objectType('SearchResult', [
    field('__typename', nonNull(named('String'))),
    field('id', nonNull(named('Int'))),
    field('name', named('String')),
    field('title', named('String')),
    field('email', named('String')),
  ]));

  return { types, queryType: 'Query', mutationType: 'Mutation' };
}

/** テストデータ */
function blogData() {
  const users = [
    { __typename: 'User', id: 1, name: '田中太郎', email: 'tanaka@example.com', role: 'ADMIN' },
    { __typename: 'User', id: 2, name: '鈴木花子', email: 'suzuki@example.com', role: 'EDITOR' },
    { __typename: 'User', id: 3, name: '佐藤次郎', email: 'sato@example.com', role: 'VIEWER' },
  ];
  const comments = [
    { __typename: 'Comment', id: 1, text: '素晴らしい記事です！', authorId: 2 },
    { __typename: 'Comment', id: 2, text: '参考になりました', authorId: 3 },
    { __typename: 'Comment', id: 3, text: '続きが読みたい', authorId: 1 },
  ];
  const posts = [
    { __typename: 'Post', id: 1, title: 'GraphQL入門', body: 'GraphQLの基礎を解説...', authorId: 1, tags: ['GraphQL', '入門'], commentIds: [1, 2] },
    { __typename: 'Post', id: 2, title: 'TypeScript実践', body: '型システムの活用...', authorId: 2, tags: ['TypeScript', '実践'], commentIds: [3] },
    { __typename: 'Post', id: 3, title: 'React Hooks', body: 'useStateとuseEffect...', authorId: 1, tags: ['React', 'Hooks'], commentIds: [] },
  ];
  return { users, posts, comments };
}

/** ブログ用リゾルバ */
function blogResolvers(): ResolverMap {
  return {
    Query: {
      user: (_p, args, ctx) => {
        const users = ctx.store['users'] as Record<string, unknown>[];
        return users?.find(u => u['id'] === args['id']) ?? null;
      },
      users: (_p, _a, ctx) => ctx.store['users'] ?? [],
      post: (_p, args, ctx) => {
        const posts = ctx.store['posts'] as Record<string, unknown>[];
        return posts?.find(p => p['id'] === args['id']) ?? null;
      },
      posts: (_p, args, ctx) => {
        const posts = ctx.store['posts'] as Record<string, unknown>[] ?? [];
        const lim = args['limit'] as number | undefined;
        return lim ? posts.slice(0, lim) : posts;
      },
      search: (_p, args, ctx) => {
        const q = (args['query'] as string).toLowerCase();
        const users = (ctx.store['users'] as Record<string, unknown>[] ?? [])
          .filter(u => (u['name'] as string).toLowerCase().includes(q));
        const posts = (ctx.store['posts'] as Record<string, unknown>[] ?? [])
          .filter(p => (p['title'] as string).toLowerCase().includes(q));
        return [...users, ...posts];
      },
    },
    Mutation: {
      createPost: (_p, args, ctx) => {
        const posts = ctx.store['posts'] as Record<string, unknown>[] ?? [];
        const newPost = {
          __typename: 'Post',
          id: posts.length + 1,
          title: args['title'],
          body: args['body'],
          authorId: args['authorId'],
          tags: [],
          commentIds: [],
        };
        posts.push(newPost);
        return newPost;
      },
      updateUser: (_p, args, ctx) => {
        const users = ctx.store['users'] as Record<string, unknown>[] ?? [];
        const user = users.find(u => u['id'] === args['id']);
        if (!user) return null;
        if (args['name']) user['name'] = args['name'];
        if (args['email']) user['email'] = args['email'];
        return user;
      },
    },
    User: {
      posts: (parent, _a, ctx) => {
        const posts = ctx.store['posts'] as Record<string, unknown>[] ?? [];
        return posts.filter(p => p['authorId'] === parent['id']);
      },
    },
    Post: {
      author: (parent, _a, ctx) => {
        const users = ctx.store['users'] as Record<string, unknown>[] ?? [];
        return users.find(u => u['id'] === parent['authorId']) ?? null;
      },
      comments: (parent, _a, ctx) => {
        const comments = ctx.store['comments'] as Record<string, unknown>[] ?? [];
        const ids = parent['commentIds'] as number[] ?? [];
        return comments.filter(c => ids.includes(c['id'] as number));
      },
    },
    Comment: {
      author: (parent, _a, ctx) => {
        const users = ctx.store['users'] as Record<string, unknown>[] ?? [];
        return users.find(u => u['id'] === parent['authorId']) ?? null;
      },
    },
  };
}

/* ================================================================
   プリセット定義
   ================================================================ */

export const presets: GQLPreset[] = [
  /* 1. 基本クエリ */
  {
    name: '基本クエリ (フィールド選択)',
    description: 'ユーザー情報を取得するシンプルなクエリ。フィールド選択とリゾルバ解決の流れ。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query GetUser {
  user(id: 1) {
    id
    name
    email
    role
  }
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 2. ネストしたクエリ */
  {
    name: 'ネストクエリ (関連データ)',
    description: 'ユーザー→投稿→コメントと深くネストしたリレーション解決を追跡。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query UserWithPosts {
  user(id: 1) {
    name
    posts {
      title
      comments {
        text
        author {
          name
        }
      }
    }
  }
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 3. エイリアス */
  {
    name: 'エイリアス (フィールド別名)',
    description: '同じフィールドを異なる引数で複数回取得。エイリアスによる名前の区別。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query TwoUsers {
  admin: user(id: 1) {
    name
    email
  }
  editor: user(id: 2) {
    name
    email
  }
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 4. フラグメント */
  {
    name: 'フラグメント (再利用可能な選択)',
    description: 'fragment で共通フィールドを定義し、複数の箇所で展開。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query WithFragment {
  user(id: 1) {
    ...UserInfo
    posts {
      title
    }
  }
}

fragment UserInfo on User {
  id
  name
  email
  role
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 5. 変数 */
  {
    name: '変数 ($variables)',
    description: 'クエリパラメータを変数で外部から注入。変数の解決過程を観察。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query GetUser($userId: Int!) {
  user(id: $userId) {
    name
    email
    posts {
      title
    }
  }
}`,
        blogSchema(), blogResolvers(),
        { userId: 2 },
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 6. ディレクティブ (@skip / @include) */
  {
    name: 'ディレクティブ (@skip / @include)',
    description: '条件付きフィールド取得。@skip(if: true) と @include(if: false) の動作。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query Conditional($showEmail: Boolean!, $hidePosts: Boolean!) {
  user(id: 1) {
    name
    email @include(if: $showEmail)
    posts @skip(if: $hidePosts) {
      title
    }
  }
}`,
        blogSchema(), blogResolvers(),
        { showEmail: false, hidePosts: true },
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 7. ミューテーション */
  {
    name: 'ミューテーション (データ変更)',
    description: '新しい投稿を作成するmutation。書き込み操作と戻り値の取得。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `mutation CreateNewPost {
  createPost(title: "新しい記事", body: "記事の内容...", authorId: 1) {
    id
    title
    author {
      name
    }
  }
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: [...data.posts], comments: data.comments },
      );
    },
  },

  /* 8. リスト取得と引数 */
  {
    name: 'リストとフィルタ引数',
    description: '投稿リストをlimit引数で取得。リスト内の各要素のリゾルバ解決を追跡。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query RecentPosts {
  posts(limit: 2) {
    id
    title
    author {
      name
    }
    tags
  }
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 9. N+1問題の可視化 */
  {
    name: 'N+1問題の可視化',
    description: '全ユーザーの投稿を取得。各ユーザーごとにpostsリゾルバが呼ばれるN+1問題。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query AllUsersWithPosts {
  users {
    id
    name
    posts {
      title
      author {
        name
      }
    }
  }
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 10. __typename とインラインフラグメント */
  {
    name: '__typename とインラインフラグメント',
    description: 'Union型の検索結果を__typenameで判別し、インラインフラグメントで型別フィールドを取得。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query Search {
  search(query: "太郎") {
    __typename
    ... on User {
      name
      email
    }
    ... on Post {
      title
    }
  }
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 11. バリデーションエラー */
  {
    name: 'バリデーションエラー',
    description: '存在しないフィールドへのクエリ。バリデーションフェーズでエラーが検出される様子。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query Invalid {
  user(id: 1) {
    name
    nonExistentField
    email
    alsoMissing
  }
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },

  /* 12. 深いネスト */
  {
    name: '深いネスト (4階層)',
    description: 'ユーザー→投稿→コメント→コメント著者→投稿。リゾルバ呼び出しの深度追跡。',
    build: () => {
      const data = blogData();
      return runGraphQL(
        `query DeepNest {
  users {
    name
    posts {
      title
      comments {
        text
        author {
          name
          posts {
            title
          }
        }
      }
    }
  }
}`,
        blogSchema(), blogResolvers(), {},
        { users: data.users, posts: data.posts, comments: data.comments },
      );
    },
  },
];
